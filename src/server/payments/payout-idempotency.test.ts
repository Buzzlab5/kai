import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocked prisma on purpose: these cases cover the double-pay guards and must never touch the shared DB.
const db = vi.hoisted(() => ({
  bluePassLedgerEntry: { findUniqueOrThrow: vi.fn() },
  bluePassOperatorPayout: { findUnique: vi.fn(), upsert: vi.fn() },
  pmsBookingLedgerEntry: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  pmsBookingOperatorPayout: { findUnique: vi.fn(), upsert: vi.fn() },
  bluePassInquiry: { findUnique: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const repo = vi.hoisted(() => ({
  createBluePassInquiryEvent: vi.fn(),
  finalizeBluePassLedgerForConfirmedBooking: vi.fn(),
  markBluePassLedgerEntryPaid: vi.fn(async () => ({ paid: true }))
}));
vi.mock("@/server/bluepass/bluepass-inquiry-repository", () => repo);

import {
  handleBluePassCheckoutSessionCompleted,
  payoutIdempotencyKey,
  releaseBluePassLedgerEntryPayoutViaStripe
} from "./bluepass-stripe";
import { releasePmsBookingLedgerEntryPayoutViaStripe } from "./bluepass-pms-stripe";

const entry = {
  id: "entry_1",
  tenantId: "t1",
  kind: "OPERATOR_PAYOUT_PLACEHOLDER",
  status: "FINALIZED",
  paidOutAt: null,
  amountCents: 8000,
  currency: "AUD"
};
const input = { entryId: "entry_1", stripeConnectAccountId: "acct_op", reviewerEmail: "admin@bluepass.co" };

function stripeWith(create = vi.fn(async () => ({ id: "tr_new" }))) {
  return { create, client: { transfers: { create } } as never };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.bluePassLedgerEntry.findUniqueOrThrow.mockResolvedValue(entry);
  db.pmsBookingLedgerEntry.findUniqueOrThrow.mockResolvedValue(entry);
  db.pmsBookingLedgerEntry.update.mockResolvedValue({ paid: true });
});

describe("payoutIdempotencyKey", () => {
  it("is stable per entry, and changes only once a failure has been recorded", () => {
    expect(payoutIdempotencyKey("bluepass", "e1")).toBe(payoutIdempotencyKey("bluepass", "e1"));
    expect(payoutIdempotencyKey("bluepass", "e1")).not.toBe(payoutIdempotencyKey("pms", "e1"));
    const failed = { updatedAt: new Date(1000) };
    expect(payoutIdempotencyKey("bluepass", "e1", failed)).not.toBe(payoutIdempotencyKey("bluepass", "e1"));
    expect(payoutIdempotencyKey("bluepass", "e1", failed)).toBe(payoutIdempotencyKey("bluepass", "e1", { updatedAt: new Date(1000) }));
    expect(payoutIdempotencyKey("bluepass", "e1", failed)).not.toBe(payoutIdempotencyKey("bluepass", "e1", { updatedAt: new Date(2000) }));
  });
});

describe.each([
  ["marketplace", releaseBluePassLedgerEntryPayoutViaStripe, db.bluePassOperatorPayout, "bluepass"],
  ["pms", releasePmsBookingLedgerEntryPayoutViaStripe, db.pmsBookingOperatorPayout, "pms"]
] as const)("%s payout release", (_name, release, payoutDb, kind) => {
  it("sends the transfer with an idempotency key tied to the ledger entry", async () => {
    payoutDb.findUnique.mockResolvedValue(null);
    const { create, client } = stripeWith();
    await release(input, { stripeClient: client });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      { amount: 8000, currency: "aud", destination: "acct_op" },
      { idempotencyKey: payoutIdempotencyKey(kind, "entry_1") }
    );
  });

  it("never transfers again when the payout row already says TRANSFERRED (crash before the entry was marked paid)", async () => {
    payoutDb.findUnique.mockResolvedValue({ status: "TRANSFERRED", stripeTransferId: "tr_old", updatedAt: new Date() });
    const { create, client } = stripeWith();
    await release(input, { stripeClient: client });
    expect(create).not.toHaveBeenCalled();
    expect(payoutDb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ stripeTransferId: "tr_old", status: "TRANSFERRED" }) })
    );
  });

  it("retries a FAILED payout under a fresh key so Stripe does not replay the old failure", async () => {
    const failed = { status: "FAILED", stripeTransferId: null, updatedAt: new Date(5000) };
    payoutDb.findUnique.mockResolvedValue(failed);
    const { create, client } = stripeWith();
    await release(input, { stripeClient: client });
    expect(create).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: payoutIdempotencyKey(kind, "entry_1", failed) });
    expect(payoutIdempotencyKey(kind, "entry_1", failed)).not.toBe(payoutIdempotencyKey(kind, "entry_1"));
  });
});

describe("checkout.session.completed redelivery", () => {
  it("still finalizes the ledger when the payment was already marked SUCCEEDED but the first run died before finalizing", async () => {
    const prismaMock = (await import("@/lib/prisma")).prisma as unknown as {
      bluePassPaymentIntent?: { findUnique: ReturnType<typeof vi.fn> };
    };
    prismaMock.bluePassPaymentIntent = {
      findUnique: vi.fn(async () => ({ id: "pi1", status: "SUCCEEDED", bluePassInquiryId: "inq1" }))
    };
    db.bluePassInquiry.findUnique.mockResolvedValue({ id: "inq1" });

    await handleBluePassCheckoutSessionCompleted({ id: "cs_1" } as never);

    expect(repo.finalizeBluePassLedgerForConfirmedBooking).toHaveBeenCalledWith({ id: "inq1" });
    expect(repo.createBluePassInquiryEvent).not.toHaveBeenCalled();
  });
});
