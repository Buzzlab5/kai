import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * At-least-once delivery is part of Meta's webhook contract: the same message id can arrive
 * again after a timeout or transient 5xx, and Meta may also deliver concurrently.
 *
 * Guarantees and limits of this dedupe:
 * - A message id is claimed (receipt row inserted) before any side effects. Concurrent
 *   same-id deliveries race on the unique constraint; exactly one wins and handles.
 * - A delivery whose receipt already has an outcome recorded is acknowledged and skipped:
 *   it was fully handled before.
 * - A receipt with NO outcome means a previous attempt is either still in flight or died
 *   between claim and handling. Liveness is fenced by a heartbeat, not a fixed timeout: the
 *   attempt holding the claim refreshes `heartbeatAt` while it works, so a slow handler
 *   (LLM latency, provider stalls) is never taken over mid-flight. A redelivery that finds a
 *   fresh heartbeat answers "in flight" and does NOT process; a redelivery that finds a stale
 *   or released heartbeat (the holder is gone) atomically takes the claim over with a
 *   compare-and-set on the claim token and reprocesses.
 * - An attempt that finishes without recording an outcome (e.g. a traveller notification
 *   failure the provider must retry) releases its claim explicitly, so the next redelivery
 *   reclaims immediately instead of waiting for the heartbeat to go stale.
 * - Reprocessing is safe because operator-response transitions are idempotent (CAS status
 *   guards, once-only event guards, and a fenced, capped traveller-notification re-drive in
 *   the inquiry repository); a conversational message redelivered after a completed first
 *   attempt is skipped on its recorded context-handling event.
 * - Limits: exactly-once processing of a crashed attempt is not achievable without provider
 *   idempotency keys (Meta does not offer them). The heartbeat is defense, not proof of
 *   exclusive liveness: a process or database pause beyond HEARTBEAT_STALE_MS lets a
 *   redelivery take the claim over while the old attempt is technically still alive. The
 *   actual fence is the claim token: every side-effecting step re-verifies token ownership
 *   first, and heartbeat refresh, outcome writes and claim release all compare-and-set on
 *   the token, so a fenced-out attempt cannot extend, release or complete a claim it lost.
 *   What it cannot undo is side effects it already ran; operator transitions bound those via
 *   CAS status guards and the inquiry repository's fenced notification delivery, and the
 *   durable receipt (outcome NULL, heartbeat stale) keeps any such case visible.
 */
export const CLAIM_GRACE_MS = 2000;
export const HEARTBEAT_STALE_MS = 45_000;
export const HEARTBEAT_INTERVAL_MS = 5000;
const CLAIM_GRACE_POLL_MS = 100;
const MAX_RECLAIM_ROUNDS = 3;

function claimGraceMs() {
  const override = Number(process.env.WHATSAPP_INBOUND_CLAIM_GRACE_MS);
  return Number.isFinite(override) && override >= 0 ? override : CLAIM_GRACE_MS;
}

function heartbeatStaleMs() {
  const override = Number(
    process.env.WHATSAPP_INBOUND_HEARTBEAT_STALE_MS ?? process.env.WHATSAPP_INBOUND_STALE_CLAIM_MS
  );
  return Number.isFinite(override) && override >= 0 ? override : HEARTBEAT_STALE_MS;
}

export function heartbeatIntervalMs() {
  const override = Number(process.env.WHATSAPP_INBOUND_HEARTBEAT_INTERVAL_MS);
  return Number.isFinite(override) && override > 0 ? override : HEARTBEAT_INTERVAL_MS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WhatsAppInboundMessageClaim =
  | { state: "fresh"; claimToken: string }
  | { state: "reclaimed"; claimToken: string }
  | { state: "in_flight" }
  | { state: "duplicate" };

export async function claimWhatsAppInboundMessage(input: {
  providerMessageId: string;
  fromPhone?: string | null;
}): Promise<WhatsAppInboundMessageClaim> {
  const claimToken = randomUUID();
  try {
    await prisma.whatsAppInboundMessageReceipt.create({
      data: {
        providerMessageId: input.providerMessageId,
        fromPhone: input.fromPhone ?? null,
        claimToken,
        heartbeatAt: new Date()
      }
    });
    return { state: "fresh", claimToken };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
  }

  // The id is already claimed. A fresh heartbeat means a live attempt owns it right now:
  // answer "in flight" and let that attempt finish instead of racing it. Only a stale or
  // released claim is a takeover candidate.
  const existing = await prisma.whatsAppInboundMessageReceipt.findUnique({
    where: { providerMessageId: input.providerMessageId }
  });
  if (!existing || existing.outcome) {
    return { state: "duplicate" };
  }
  if (existing.heartbeatAt && existing.heartbeatAt > new Date(Date.now() - heartbeatStaleMs())) {
    return { state: "in_flight" };
  }

  // The previous attempt is gone (or a legacy claim without heartbeats). Give a just-finishing
  // attempt a short grace window to record its outcome before taking over.
  const graceDeadline = Date.now() + claimGraceMs();
  while (Date.now() < graceDeadline) {
    await sleep(Math.min(CLAIM_GRACE_POLL_MS, Math.max(10, claimGraceMs() / 4)));
    const current = await prisma.whatsAppInboundMessageReceipt.findUnique({
      where: { providerMessageId: input.providerMessageId }
    });
    if (!current || current.outcome) {
      return { state: "duplicate" };
    }
    if (current.heartbeatAt && current.heartbeatAt > new Date(Date.now() - heartbeatStaleMs())) {
      return { state: "in_flight" };
    }
  }

  for (let round = 0; round < MAX_RECLAIM_ROUNDS; round += 1) {
    const current = await prisma.whatsAppInboundMessageReceipt.findUnique({
      where: { providerMessageId: input.providerMessageId }
    });
    if (!current || current.outcome) {
      return { state: "duplicate" };
    }
    if (current.heartbeatAt && current.heartbeatAt > new Date(Date.now() - heartbeatStaleMs())) {
      return { state: "in_flight" };
    }
    const reclaimed = await prisma.whatsAppInboundMessageReceipt.updateMany({
      where: {
        providerMessageId: input.providerMessageId,
        outcome: null,
        claimToken: current.claimToken
      },
      data: {
        claimToken,
        heartbeatAt: new Date(),
        receivedAt: new Date(),
        fromPhone: input.fromPhone ?? current.fromPhone
      }
    });
    if (reclaimed.count === 1) {
      return { state: "reclaimed", claimToken };
    }
    // Lost the takeover race to a concurrent redelivery; re-read and judge again.
  }

  return { state: "in_flight" };
}

/**
 * Liveness proof for the attempt holding a claim. The webhook route refreshes this on an
 * interval while it processes; compare-and-set on the claim token means an attempt that lost
 * its claim can no longer extend it. Never throws: the fence must not break handling.
 */
export async function refreshWhatsAppInboundMessageHeartbeat(input: {
  providerMessageId: string;
  claimToken: string;
}): Promise<void> {
  try {
    await prisma.whatsAppInboundMessageReceipt.updateMany({
      where: {
        providerMessageId: input.providerMessageId,
        claimToken: input.claimToken,
        outcome: null
      },
      data: { heartbeatAt: new Date() }
    });
  } catch {
    // Heartbeats are best-effort; a missed beat only delays reclaim by the stale window.
  }
}

/**
 * Explicit end-of-attempt release for a claim whose outcome is intentionally left unrecorded
 * (e.g. a notification failure the provider will redeliver). Clearing the heartbeat lets the
 * next redelivery reclaim immediately. Compare-and-set on the claim token keeps a fenced-out
 * attempt from releasing a claim it no longer owns. Never throws.
 */
export async function releaseWhatsAppInboundMessageClaim(input: {
  providerMessageId: string;
  claimToken: string;
}): Promise<void> {
  try {
    await prisma.whatsAppInboundMessageReceipt.updateMany({
      where: {
        providerMessageId: input.providerMessageId,
        claimToken: input.claimToken,
        outcome: null
      },
      data: { heartbeatAt: null }
    });
  } catch {
    // A missed release only delays reclaim until the heartbeat goes stale.
  }
}

/**
 * Token fence check before a side effect: true only while this attempt still owns the claim.
 * The webhook route calls this immediately before running a handler whose effects cannot be
 * undone (operator transitions, conversational replies); a false result means a redelivery
 * took the message over and this attempt must stop without touching anything.
 */
export async function verifyWhatsAppInboundMessageClaim(input: {
  providerMessageId: string;
  claimToken: string;
}): Promise<boolean> {
  try {
    const receipt = await prisma.whatsAppInboundMessageReceipt.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select: { claimToken: true, outcome: true }
    });
    return Boolean(receipt && receipt.claimToken === input.claimToken && !receipt.outcome);
  } catch {
    // On a verification error, fail closed: do not run side effects on an unverifiable fence.
    return false;
  }
}

/** Best-effort annotation of how a claimed message ended up; never fails the webhook. */
export async function recordWhatsAppInboundMessageOutcome(input: {
  providerMessageId: string;
  outcome: string;
  bluePassInquiryId?: string | null;
  claimToken?: string | null;
}): Promise<void> {
  try {
    await prisma.whatsAppInboundMessageReceipt.updateMany({
      where: {
        providerMessageId: input.providerMessageId,
        ...(input.claimToken ? { claimToken: input.claimToken } : {})
      },
      data: {
        outcome: input.outcome,
        bluePassInquiryId: input.bluePassInquiryId ?? undefined
      }
    });
  } catch {
    // Outcome bookkeeping must never break webhook handling.
  }
}
