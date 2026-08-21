import type { CancelledBy, CancellationPolicyTier, RefundTierDecision } from "./types";

const MS_PER_DAY = 86_400_000;

/**
 * Platform-default cancellation policy, used only when an operator hasn't set their own via
 * bluepass-redesign's operator dashboard (components/operator/OperatorCancellationPolicy.tsx -
 * OperatorProfile.cancellationPolicyTiers stays null until they save one). This is a clearly-labeled
 * placeholder, not any real operator's actual terms - same honesty bar already used for the Discover
 * impactSplit placeholder. A reasonable, defensible shape in the spirit of PAYMENT_ARCHITECTURE.md's
 * own comparables (Master Liveaboards, PADI, Liveaboard.com), pending Tony/BD confirming a real
 * default.
 */
export const DEFAULT_CANCELLATION_POLICY_TIERS: CancellationPolicyTier[] = [
  { minDaysBeforeDeparture: 14, refundPercent: 100 },
  { minDaysBeforeDeparture: 3, refundPercent: 50 },
  { minDaysBeforeDeparture: 0, refundPercent: 0 }
];

/**
 * A usable policy must have a 0-day floor tier so every cancellation resolves to *some* percentage -
 * without it, a cancellation inside the smallest tier's window would have no matching row. Falls
 * back to the platform default (fail closed to a known-good shape) rather than crash or guess on a
 * malformed operator-supplied policy.
 */
function normalizePolicy(policy: CancellationPolicyTier[] | null): CancellationPolicyTier[] {
  if (!policy || policy.length === 0) return DEFAULT_CANCELLATION_POLICY_TIERS;
  const hasFloor = policy.some((tier) => tier.minDaysBeforeDeparture <= 0);
  const allValid = policy.every(
    (tier) =>
      Number.isFinite(tier.minDaysBeforeDeparture) &&
      Number.isFinite(tier.refundPercent) &&
      tier.refundPercent >= 0 &&
      tier.refundPercent <= 100
  );
  return hasFloor && allValid ? policy : DEFAULT_CANCELLATION_POLICY_TIERS;
}

/**
 * Resolves the refund percentage for one cancellation. Operator-initiated cancellations always get
 * 100% immediately, per the brief ("Operator cancels -> full immediate refund from held funds") -
 * no tier lookup needed. Customer/admin-initiated cancellations are matched against the policy by
 * the largest tier threshold the cancellation still clears (sorted descending).
 *
 * Returns `resolved: false` when travelDate is null (the booking's dateText couldn't be parsed into
 * a real date - see parseAttemptTravelDate) - the caller must never guess a tier in that case, only
 * surface it for manual handling, matching the same fail-closed posture as the settlement sweep.
 */
export function resolveRefundTierPercent(input: {
  cancelledBy: CancelledBy;
  travelDate: Date | null;
  cancelledAt: Date;
  policy: CancellationPolicyTier[] | null;
}): RefundTierDecision {
  if (input.cancelledBy === "OPERATOR") {
    return { resolved: true, refundPercent: 100, daysBeforeDeparture: null };
  }

  if (!input.travelDate) {
    return { resolved: false, refundPercent: null, daysBeforeDeparture: null };
  }

  const daysBeforeDeparture = (input.travelDate.getTime() - input.cancelledAt.getTime()) / MS_PER_DAY;
  const tiers = [...normalizePolicy(input.policy)].sort(
    (a, b) => b.minDaysBeforeDeparture - a.minDaysBeforeDeparture
  );
  const matchedTier = tiers.find((tier) => daysBeforeDeparture >= tier.minDaysBeforeDeparture);
  // normalizePolicy guarantees a 0-day floor tier, so matchedTier is only undefined when
  // daysBeforeDeparture is negative (cancelling after the travel date has already passed) - treat
  // that as the floor tier's percentage too, rather than leaving it unresolved.
  const refundPercent = matchedTier?.refundPercent ?? tiers[tiers.length - 1]?.refundPercent ?? 0;

  return { resolved: true, refundPercent, daysBeforeDeparture };
}

/**
 * The tiers, in plain English, for disclosure to a traveller before they pay - the same
 * normalization `resolveRefundTierPercent` applies (so a malformed or floorless operator policy
 * reads as the platform default here too, never as broken or missing text). Built generally rather
 * than hardcoded to the 3-tier default shape, since an operator can save any number of tiers.
 */
export function formatCancellationPolicySummary(policy: CancellationPolicyTier[] | null): string {
  const tiers = [...normalizePolicy(policy)].sort(
    (a, b) => b.minDaysBeforeDeparture - a.minDaysBeforeDeparture
  );

  return tiers
    .map((tier, i) => {
      const refundLabel =
        tier.refundPercent === 100
          ? "Full refund"
          : tier.refundPercent === 0
            ? "no refund"
            : `${tier.refundPercent}% refund`;

      if (i === 0) {
        return `${refundLabel} ${tier.minDaysBeforeDeparture}+ days before departure`;
      }

      const prevThreshold = tiers[i - 1].minDaysBeforeDeparture;
      const windowLabel =
        tier.minDaysBeforeDeparture === 0
          ? `within ${prevThreshold} day${prevThreshold === 1 ? "" : "s"}`
          : `${tier.minDaysBeforeDeparture}-${prevThreshold - 1} days before`;

      return `${refundLabel} ${windowLabel}`;
    })
    .join(", ");
}
