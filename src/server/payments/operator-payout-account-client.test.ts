import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOperatorPayoutAccount } from "./operator-payout-account-client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveOperatorPayoutAccount", () => {
  it("calls bluepass-redesign's internal endpoint with the tenant slug and bearer token", async () => {
    process.env.BLUEPASS_APP_URL = "https://bluepass.co";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "shared-secret";
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ stripeConnectAccountId: "acct_123", chargesEnabled: true, payoutsEnabled: true }), {
        status: 200
      })
    );

    const result = await resolveOperatorPayoutAccount("boattime", { fetcher: fetcher as unknown as typeof fetch });

    expect(result).toEqual({
      stripeConnectAccountId: "acct_123",
      chargesEnabled: true,
      payoutsEnabled: true,
      cancellationPolicyTiers: null,
      payoutMethod: "MANUAL_BANK_TRANSFER"
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bluepass.co/api/internal/operator-payout-account?tenantSlug=boattime");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer shared-secret");
  });

  it("passes through the operator's cancellation policy tiers when the operator has set one", async () => {
    process.env.BLUEPASS_APP_URL = "https://bluepass.co";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "shared-secret";
    const tiers = [
      { minDaysBeforeDeparture: 14, refundPercent: 100 },
      { minDaysBeforeDeparture: 0, refundPercent: 25 }
    ];
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          stripeConnectAccountId: "acct_123",
          chargesEnabled: true,
          payoutsEnabled: true,
          cancellationPolicyTiers: tiers
        }),
        { status: 200 }
      )
    );

    const result = await resolveOperatorPayoutAccount("boattime", { fetcher: fetcher as unknown as typeof fetch });

    expect(result?.cancellationPolicyTiers).toEqual(tiers);
  });

  it("passes through the operator's payoutMethod, including AIRWALLEX", async () => {
    process.env.BLUEPASS_APP_URL = "https://bluepass.co";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "shared-secret";
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ stripeConnectAccountId: null, chargesEnabled: false, payoutsEnabled: false, payoutMethod: "AIRWALLEX" }),
        { status: 200 }
      )
    );

    const result = await resolveOperatorPayoutAccount("some-id-operator", { fetcher: fetcher as unknown as typeof fetch });

    expect(result?.payoutMethod).toBe("AIRWALLEX");
  });

  it("returns null when BLUEPASS_APP_URL or the service token is not configured", async () => {
    delete process.env.BLUEPASS_APP_URL;
    delete process.env.NEXT_PUBLIC_BLUEPASS_APP_URL;
    delete process.env.BLUEPASS_APP_SERVICE_TOKEN;
    delete process.env.KAI_ADMIN_TOKEN;
    delete process.env.KAI_CORE_ADMIN_TOKEN;

    const fetcher = vi.fn();
    await expect(
      resolveOperatorPayoutAccount("boattime", { fetcher: fetcher as unknown as typeof fetch })
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed (returns null) rather than throwing when the response is not ok", async () => {
    process.env.BLUEPASS_APP_URL = "https://bluepass.co";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "shared-secret";
    const fetcher = vi.fn(async () => new Response("", { status: 404 }));

    await expect(
      resolveOperatorPayoutAccount("unknown-tenant", { fetcher: fetcher as unknown as typeof fetch })
    ).resolves.toBeNull();
  });

  it("fails closed when the fetch itself throws (network error)", async () => {
    process.env.BLUEPASS_APP_URL = "https://bluepass.co";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "shared-secret";
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      resolveOperatorPayoutAccount("boattime", { fetcher: fetcher as unknown as typeof fetch })
    ).resolves.toBeNull();
  });
});
