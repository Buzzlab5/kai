import { NextResponse } from "next/server";
import {
  findDispatchedBluePassOperatorPhones,
  findLatestBluePassParticipantContext,
  handleBluePassOperatorResponse,
  hasBluePassContextMessageBeenProcessed,
  recordBluePassTravellerWhatsAppDeliveryStatus,
  resolveLatestPendingBluePassInquiryIdForOperatorPhone
} from "@/server/bluepass/bluepass-inquiry-repository";
import {
  claimWhatsAppInboundMessage,
  heartbeatIntervalMs,
  recordWhatsAppInboundMessageOutcome,
  refreshWhatsAppInboundMessageHeartbeat,
  releaseWhatsAppInboundMessageClaim,
  verifyWhatsAppInboundMessageClaim
} from "@/server/whatsapp/inbound-message-receipt";
import { handleBluePassWhatsAppInboundMessage } from "@/server/bluepass/bluepass-whatsapp-conversation";
import { handleNativeOperatorWhatsApp } from "@/server/native/native-operator-whatsapp";
import { handleGenericWhatsAppInboundMessage } from "@/server/whatsapp/generic-whatsapp-conversation";
import { resolveWhatsAppTenantForMessage } from "@/server/whatsapp/generic-tenant-router";
import {
  extractBluePassOperatorResponsesFromWhatsAppWebhook,
  extractWhatsAppInboundTextMessagesFromWebhook,
  extractWhatsAppMessageStatusesFromWebhook
} from "@/server/whatsapp/webhook";
import { sendWhatsAppTypingIndicator } from "@/server/whatsapp/client";
import { authorizeWhatsAppWebhook } from "@/server/whatsapp/webhook-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = authorizeWhatsAppWebhook({
    rawBody,
    signatureHeader: request.headers.get("x-hub-signature-256"),
    authorizationHeader: request.headers.get("authorization")
  });
  if (!auth.ok) {
    const override = process.env.WHATSAPP_ALLOW_UNSIGNED;
    console.warn("whatsapp.webhook.rejected", {
      reason: auth.reason,
      // The flag is not a secret: the exact string shows a quoted, padded or oddly cased value.
      allowUnsigned: override === undefined ? "unset" : JSON.stringify(override)
    });
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }
  if (auth.via === "unsigned_override") {
    console.warn("whatsapp.webhook.accepted_unsigned", {
      note: "WHATSAPP_ALLOW_UNSIGNED is on and WHATSAPP_APP_SECRET is missing; set the secret and remove the override."
    });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }
  const inboundMessages = extractWhatsAppInboundTextMessagesFromWebhook(payload);

  // Meta delivers at least once: claim each inbound message id first so a redelivery is
  // acknowledged without re-running operator responses, traveller notifications or quotes.
  // A message whose previous attempt is still alive (fresh heartbeat) is answered
  // "in flight" with a 500 below so Meta redelivers it later - it is never processed
  // concurrently with the attempt holding its claim.
  const freshMessages: typeof inboundMessages = [];
  const freshMessageIds = new Set<string>();
  const claimStates = new Map<string, string>();
  const claimTokens = new Map<string, string>();
  let duplicates = 0;
  let reclaimed = 0;
  let inFlight = 0;
  for (const message of inboundMessages) {
    if (!message.providerMessageId) {
      freshMessages.push(message);
      continue;
    }
    const claim = await claimWhatsAppInboundMessage({
      providerMessageId: message.providerMessageId,
      fromPhone: message.from
    });
    claimStates.set(message.providerMessageId, claim.state);
    if (claim.state === "duplicate") {
      duplicates += 1;
      continue;
    }
    if (claim.state === "in_flight") {
      inFlight += 1;
      continue;
    }
    claimTokens.set(message.providerMessageId, claim.claimToken);
    // "reclaimed" means an earlier delivery crashed before handling; reprocess it - the
    // idempotent operator-response transitions make that safe.
    if (claim.state === "reclaimed") {
      reclaimed += 1;
    }
    freshMessages.push(message);
    freshMessageIds.add(message.providerMessageId);
  }

  // Heartbeat fence: while this attempt works it proves liveness for every claim it holds,
  // so a slow handler (LLM latency, provider stalls) is never taken over mid-flight. The
  // heartbeat is defense, not proof - each side effect re-verifies the claim token first,
  // and the claim is released in the finally below so a finished-but-unrecorded attempt is
  // reclaimable immediately.
  const heartbeatTimer = claimTokens.size
    ? setInterval(() => {
        for (const [providerMessageId, claimToken] of claimTokens) {
          void refreshWhatsAppInboundMessageHeartbeat({ providerMessageId, claimToken }).catch(() => undefined);
        }
      }, heartbeatIntervalMs())
    : null;
  heartbeatTimer?.unref?.();

  // Token fence before side effects: a claim lost mid-attempt (process/DB pause beyond the
  // heartbeat window) means a redelivery owns this message now - stop without touching it.
  const fencedOut = new Set<string>();
  const ownsClaim = async (providerMessageId: string) => {
    if (fencedOut.has(providerMessageId)) return false;
    const claimToken = claimTokens.get(providerMessageId);
    if (!claimToken) return true;
    const owned = await verifyWhatsAppInboundMessageClaim({ providerMessageId, claimToken });
    if (!owned) {
      fencedOut.add(providerMessageId);
      inFlight += 1;
    }
    return owned;
  };

  try {

  // An operator answering a paid native booking ("ACCEPT <ref>" / "DECLINE <ref>") is settled first
  // and taken out of everything below, so a plain "accept" is never read as a BluePass inquiry reply.
  const answeredNatively = new Set<string>();
  const nativeFailures: Array<{ providerMessageId: string | null; reason: string }> = [];
  for (const message of freshMessages) {
    try {
      if (message.providerMessageId && !(await ownsClaim(message.providerMessageId))) {
        inFlight += 1;
        continue;
      }
      if ((await handleNativeOperatorWhatsApp(message)).handled && message.providerMessageId) {
        answeredNatively.add(message.providerMessageId);
        await recordWhatsAppInboundMessageOutcome({
          providerMessageId: message.providerMessageId,
          outcome: "native_answer",
          claimToken: claimTokens.get(message.providerMessageId)
        });
      }
    } catch (error) {
      nativeFailures.push({
        providerMessageId: message.providerMessageId,
        reason: error instanceof Error ? error.message : "Native booking answer failed."
      });
    }
  }

  // Strict parsing: informal operator replies (bare "accept", free-text availability/price
  // details) only count from phones holding a BluePass dispatch. The same words from a traveller
  // fall through to conversation handling below instead of being swallowed as an operator reply.
  const knownOperatorPhones = await findDispatchedBluePassOperatorPhones(freshMessages.map((message) => message.from));
  const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(payload, {
    knownOperatorPhones
  }).filter(
    (response) =>
      (!response.providerMessageId || freshMessageIds.has(response.providerMessageId)) &&
      (!response.providerMessageId || !answeredNatively.has(response.providerMessageId))
  );
  const responseMessageIds = new Set(
    responses.map((response) => response.providerMessageId).filter((id): id is string => Boolean(id))
  );
  const idlessResponseSenders = new Set(
    responses.filter((response) => !response.providerMessageId).map((response) => response.operatorPhone)
  );
  const statuses = extractWhatsAppMessageStatusesFromWebhook(payload);
  const contextMessages = freshMessages.filter(
    (message) =>
      (!message.providerMessageId || !answeredNatively.has(message.providerMessageId)) &&
      (!message.providerMessageId || !responseMessageIds.has(message.providerMessageId)) &&
      !idlessResponseSenders.has(message.from)
  );
  const failures: Array<{ inquiryId: string; reason: string }> = [];
  const statusFailures: Array<{ providerMessageId: string; reason: string }> = [];
  const contextFailures: Array<{ providerMessageId: string | null; reason: string }> = [];
  let handled = 0;
  let statusesHandled = 0;
  let contextHandled = 0;

  const notificationFailures: Array<{ inquiryId: string; providerMessageId: string | null; reason: string }> = [];
  const notificationRecoveryExhausted: Array<{ inquiryId: string; providerMessageId: string | null }> = [];

  for (const response of responses) {
    try {
      const inquiryId =
        response.inquiryId ?? (await resolveLatestPendingBluePassInquiryIdForOperatorPhone(response.operatorPhone));
      if (!inquiryId) {
        throw new Error("No pending BluePass inquiry matched this operator response.");
      }
      if (response.providerMessageId && !(await ownsClaim(response.providerMessageId))) {
        continue;
      }

      const result = await handleBluePassOperatorResponse({
        ...response,
        inquiryId
      });
      handled += 1;
      if (response.providerMessageId) {
        const recovery = result.notificationRecovery;
        const sendFailed = result.travellerNotification?.whatsappDeliveryFailed === true;
        const recoveryExhausted = recovery?.state === "exhausted";
        if (sendFailed && !recoveryExhausted) {
          // The traveller notification could not be delivered. Do NOT record an outcome: the
          // receipt stays unresolved (and the claim is released in the finally) so Meta's
          // redelivery reclaims the message and the repository's fenced re-drive sends the
          // notification, bounded by its claim cap. The 500 below is what makes Meta retry.
          notificationFailures.push({
            inquiryId,
            providerMessageId: response.providerMessageId,
            reason: result.travellerNotification?.skippedReason ?? "Traveller WhatsApp notification failed."
          });
        } else {
          if (recoveryExhausted) {
            // Bounded retries are spent: surface this as an actionable item, not a quiet 200.
            notificationRecoveryExhausted.push({ inquiryId, providerMessageId: response.providerMessageId });
          }
          await recordWhatsAppInboundMessageOutcome({
            providerMessageId: response.providerMessageId,
            outcome:
              sendFailed || recoveryExhausted
                ? "operator_response_notification_failed"
                : recovery?.state === "sent" && recovery.uncertainPrior
                  ? "operator_response_notification_uncertain_recovered"
                  : claimStates.get(response.providerMessageId) === "reclaimed"
                    ? "operator_response_reclaimed"
                    : "operator_response",
            bluePassInquiryId: inquiryId,
            claimToken: claimTokens.get(response.providerMessageId)
          });
        }
      }
    } catch (error) {
      failures.push({
        inquiryId: response.inquiryId ?? "unresolved",
        reason: error instanceof Error ? error.message : "Operator callback failed."
      });
      if (response.providerMessageId) {
        await recordWhatsAppInboundMessageOutcome({
          providerMessageId: response.providerMessageId,
          outcome: "operator_response_failed",
          bluePassInquiryId: response.inquiryId,
          claimToken: claimTokens.get(response.providerMessageId)
        });
      }
    }
  }

  for (const status of statuses) {
    try {
      await recordBluePassTravellerWhatsAppDeliveryStatus(status);
      statusesHandled += 1;
    } catch (error) {
      statusFailures.push({
        providerMessageId: status.providerMessageId,
        reason: error instanceof Error ? error.message : "WhatsApp status callback failed."
      });
    }
  }

  for (const message of contextMessages) {
    try {
      if (message.providerMessageId && !(await ownsClaim(message.providerMessageId))) {
        continue;
      }

      const routeOutcome = await resolveWhatsAppTenantForMessage({
        messageText: message.body,
        fromPhone: message.from
      });

      if (message.providerMessageId && claimStates.get(message.providerMessageId) === "reclaimed") {
        // A reclaimed conversational message whose first attempt already recorded its
        // handling events must not run again: the conversational reply is not safe to send
        // twice and the handler has no CAS equivalent. Scoped to the tenant that owns this
        // conversation - the same provider id under another tenant must not read as handled.
        const tenantScope =
          routeOutcome.kind === "TENANT"
            ? routeOutcome.tenant.id
            : ((await findLatestBluePassParticipantContext(message.from))?.inquiry.tenantId ?? null);
        const alreadyProcessed = tenantScope
          ? await hasBluePassContextMessageBeenProcessed(message.providerMessageId, tenantScope)
          : false;
        if (alreadyProcessed) {
          await recordWhatsAppInboundMessageOutcome({
            providerMessageId: message.providerMessageId,
            outcome: "context_redelivery_skipped",
            claimToken: claimTokens.get(message.providerMessageId)
          });
          continue;
        }
      }
      await sendWhatsAppTypingIndicator({
        role: "kai",
        messageId: message.providerMessageId ?? ""
      }).catch(() => undefined);

      const result =
        routeOutcome.kind === "TENANT"
          ? await handleGenericWhatsAppInboundMessage(message, routeOutcome.tenant)
          : routeOutcome.kind === "HANDLED"
            ? { handled: true }
            : await handleBluePassWhatsAppInboundMessage(message);
      if (result.handled) {
        contextHandled += 1;
      }
      if (message.providerMessageId) {
        await recordWhatsAppInboundMessageOutcome({
          providerMessageId: message.providerMessageId,
          outcome: result.handled ? "context" : "context_unhandled",
          claimToken: claimTokens.get(message.providerMessageId)
        });
      }
    } catch (error) {
      contextFailures.push({
        providerMessageId: message.providerMessageId,
        reason: error instanceof Error ? error.message : "WhatsApp context message failed."
      });
    }
  }

  // 500 when any message is still owned by a live earlier attempt (Meta must redeliver it
  // later rather than treat this ack as handled) or when a traveller notification failed and
  // its receipt was deliberately left unresolved for the redelivery to reclaim.
  return NextResponse.json(
    {
      ok: true,
      handled,
      failed: failures.length,
      duplicates,
      reclaimed,
      inFlight,
      failures,
      notificationFailed: notificationFailures.length,
      notificationFailures,
      notificationRecoveryExhausted,
      statusesHandled,
      statusesFailed: statusFailures.length,
      statusFailures,
      contextHandled,
      contextFailed: contextFailures.length + nativeFailures.length,
      contextFailures: [...contextFailures, ...nativeFailures]
    },
    { status: inFlight > 0 || notificationFailures.length > 0 ? 500 : 200 }
  );
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    // End of attempt: release every claim that has no recorded outcome so a redelivery can
    // reclaim immediately. Token-scoped: a fenced-out claim is untouched.
    for (const [providerMessageId, claimToken] of claimTokens) {
      await releaseWhatsAppInboundMessageClaim({ providerMessageId, claimToken }).catch(() => undefined);
    }
  }
}
