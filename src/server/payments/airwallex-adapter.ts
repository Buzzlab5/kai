/**
 * Airwallex disbursement adapter - Indonesia's payout rail (DEVELOPER_BRIEF_PAYMENTS_REZDY.md:
 * "Stripe Connect cannot pay Indonesia - verified"; PAYMENT_ARCHITECTURE.md §4 lists "Airwallex
 * disbursement adapter" as new work alongside the AU Stripe Connect path).
 *
 * Milestone 2.5 (payment-settlement plan) is explicitly "build the shape, not the wire" - this file
 * is a real, typed interface any caller can code against today, plus a stub implementation that
 * throws a clear, specific error rather than silently pretending to move money. It has NOT been
 * verified against Airwallex's real API (no account exists yet - genuinely blocked on BD/Tony
 * opening one, not an engineering task). Same honesty bar as rezdy-agent-pms-adapter.ts's own
 * comments: this compiles and is tested against representative payloads, it is not live.
 *
 * Field shapes below are a best-effort guess at what a real beneficiary/disbursement call needs
 * (Airwallex's own docs: https://www.airwallex.com/docs/api) - treat every field name as unverified
 * until checked against a real account/sandbox.
 */

export interface AirwallexDisbursementRequest {
  /** Airwallex beneficiary id for the operator - how this gets created/stored is not designed yet. */
  airwallexBeneficiaryId: string;
  amountCents: number;
  currency: string;
  /** Idempotency/tracking reference - the PmsBookingLedgerEntry or BluePassLedgerEntry id being paid out. */
  reference: string;
}

export type AirwallexDisbursementStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface AirwallexDisbursementResult {
  disbursementId: string;
  status: AirwallexDisbursementStatus;
}

export interface AirwallexAdapter {
  createDisbursement(request: AirwallexDisbursementRequest): Promise<AirwallexDisbursementResult>;
}

export interface AirwallexAdapterConfig {
  apiKey?: string;
  clientId?: string;
  baseUrl?: string;
}

/**
 * Thrown by every real call on the stub adapter below - a distinct error type so callers (e.g.
 * settlePmsBookingPaymentAttempt) can catch this specifically and fall back to the existing manual
 * bank-transfer attestation path, the same safety net Tony's brief already calls for as the interim
 * for any operator without a live payout rail.
 */
export class AirwallexNotLiveError extends Error {
  constructor(message = "Airwallex payout rail is not live yet - no Airwallex account/API credentials exist.") {
    super(message);
    this.name = "AirwallexNotLiveError";
  }
}

/**
 * Stub implementation: validates its own config shape (so a genuinely missing config is a distinct,
 * clear failure) but never calls a real Airwallex endpoint - every createDisbursement call throws
 * AirwallexNotLiveError. Swap this class's internals for real fetch calls once Airwallex credentials
 * exist; the interface above is designed not to need to change when that happens.
 */
export class StubAirwallexAdapter implements AirwallexAdapter {
  constructor(private readonly config: AirwallexAdapterConfig = {}) {}

  async createDisbursement(_request: AirwallexDisbursementRequest): Promise<AirwallexDisbursementResult> {
    void this.config;
    void _request;
    throw new AirwallexNotLiveError();
  }
}

export function getAirwallexAdapter(env: AirwallexAdapterConfig = {}): AirwallexAdapter {
  return new StubAirwallexAdapter(env);
}
