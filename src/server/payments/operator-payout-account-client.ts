export type CancellationPolicyTier = { minDaysBeforeDeparture: number; refundPercent: number };

/** Mirrors bluepass-redesign's OperatorPayoutMethod enum - kept as a literal union here since Kai
 * has no Prisma relation to that model to import the type from. */
export type OperatorPayoutMethod = "MANUAL_BANK_TRANSFER" | "STRIPE_CONNECT" | "AIRWALLEX";

export type OperatorPayoutAccount = {
  stripeConnectAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Null when the operator hasn't set their own policy - caller should fall back to the platform default. */
  cancellationPolicyTiers: CancellationPolicyTier[] | null;
  /** Milestone 2.5: which payout rail this operator is on - see airwallex-adapter.ts for the AIRWALLEX shape. */
  payoutMethod: OperatorPayoutMethod;
};

function resolveBluePassAppUrl() {
  const raw = process.env.BLUEPASS_APP_URL ?? process.env.NEXT_PUBLIC_BLUEPASS_APP_URL;
  return raw?.trim().replace(/\/+$/g, "") || null;
}

function resolveBluePassAppServiceToken() {
  return (
    process.env.BLUEPASS_APP_SERVICE_TOKEN?.trim() ||
    process.env.KAI_ADMIN_TOKEN?.trim() ||
    process.env.KAI_CORE_ADMIN_TOKEN?.trim() ||
    null
  );
}

/**
 * Resolves a Kai tenant's Stripe Connect payout account from bluepass-redesign's OperatorProfile
 * (see that app's lib/services/operators/operator-payout-account.ts and
 * /api/internal/operator-payout-account route) - Kai has no operator model of its own. Same
 * BLUEPASS_APP_URL/BLUEPASS_APP_SERVICE_TOKEN + Bearer-auth convention already used by
 * bluepass-operator-directory.ts's directory lookups, not a new one.
 *
 * Fails closed (returns null) on any error - missing config, network failure, non-2xx response -
 * exactly like the existing directory lookups. A caller that gets null should fall back to the
 * manual bank-transfer/attestation path, not treat this as a hard error.
 */
export async function resolveOperatorPayoutAccount(
  tenantSlug: string,
  deps: { fetcher?: typeof fetch } = {}
): Promise<OperatorPayoutAccount | null> {
  const baseUrl = resolveBluePassAppUrl();
  const token = resolveBluePassAppServiceToken();
  if (!baseUrl || !token) return null;

  const fetcher = deps.fetcher ?? fetch;

  try {
    const response = await fetcher(
      `${baseUrl}/api/internal/operator-payout-account?tenantSlug=${encodeURIComponent(tenantSlug)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as Partial<OperatorPayoutAccount>;
    return {
      stripeConnectAccountId: payload.stripeConnectAccountId ?? null,
      chargesEnabled: Boolean(payload.chargesEnabled),
      payoutsEnabled: Boolean(payload.payoutsEnabled),
      cancellationPolicyTiers: payload.cancellationPolicyTiers ?? null,
      payoutMethod: payload.payoutMethod ?? "MANUAL_BANK_TRANSFER"
    };
  } catch {
    return null;
  }
}
