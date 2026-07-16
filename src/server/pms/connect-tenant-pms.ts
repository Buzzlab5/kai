import { prisma } from "@/lib/prisma";
import type { PmsProvider as PrismaPmsProvider } from "@prisma/client";
import type { PmsProvider } from "@/core/tenant/types";
import { getPmsAdapter } from "./pms-adapter-registry";
import {
  connectablePmsProviders,
  encryptPmsCredentials,
  pmsCredentialsToEnv
} from "./tenant-pms-credentials";

export type ConnectTenantPmsResult =
  | { ok: true; provider: PmsProvider; productCount: number; sampleTitles: string[] }
  | { ok: false; code: string; error: string };

/**
 * Fill in the standard, account-independent endpoints so an operator only has to paste
 * their own key(s) - the paths are identical across all Rezdy / FareHarbor accounts.
 */
function applyProviderDefaults(provider: PmsProvider, credentials: Record<string, string>): Record<string, string> {
  const trimmed = Object.fromEntries(Object.entries(credentials).map(([k, v]) => [k, String(v ?? "").trim()]));
  if (provider === "REZDY") {
    return {
      ...trimmed,
      baseUrl: trimmed.baseUrl || "https://api.rezdy.com",
      productListPath: trimmed.productListPath || "/v1/products",
      availabilityPath: trimmed.availabilityPath || "/v1/availability",
      bookingPath: trimmed.bookingPath || "/v1/bookings"
    };
  }
  if (provider === "FAREHARBOR") {
    return {
      ...trimmed,
      baseUrl: trimmed.baseUrl || "https://fareharbor.com/api/external/v1"
    };
  }
  return trimmed;
}

/**
 * Self-serve "Connect": validate an operator's own Rezdy/FareHarbor credentials with a
 * live product-list call, and only on success store them encrypted as this tenant's
 * TenantIntegration + point the tenant's config at the provider. Never stores unvalidated
 * credentials. The stored row is what resolveTenantPmsEnv reads at request time, so once
 * this succeeds the operator's own account is live in Kai - no engineer, no env vars.
 */
export async function connectTenantPms(input: {
  tenantId: string;
  provider: PmsProvider;
  credentials: Record<string, string>;
  fetcher?: typeof fetch;
}): Promise<ConnectTenantPmsResult> {
  const { tenantId, provider } = input;
  const credentials = applyProviderDefaults(provider, input.credentials);

  if (!connectablePmsProviders().includes(provider)) {
    return {
      ok: false,
      code: "PROVIDER_NOT_CONNECTABLE",
      error: `${provider} can't be self-connected yet. Supported: ${connectablePmsProviders().join(", ")}.`
    };
  }

  const encryptionKey = process.env.PMS_CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return { ok: false, code: "NO_ENCRYPTION_KEY", error: "Server is missing PMS_CREDENTIAL_ENCRYPTION_KEY." };
  }

  // 1) Validate the credentials with a real call before storing anything.
  let products;
  try {
    const env = pmsCredentialsToEnv(provider, credentials);
    const adapter = getPmsAdapter(provider, { ...process.env, ...env }, input.fetcher ?? fetch);
    products = await adapter.listProducts();
  } catch (error) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      error: `Couldn't reach ${provider} with those details: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (!Array.isArray(products) || products.length === 0) {
    return {
      ok: false,
      code: "NO_PRODUCTS",
      error: `Connected to ${provider}, but it returned no products. Check the account has published, bookable products.`
    };
  }

  // 2) Only now: encrypt + store + activate + point the tenant at this provider.
  const encryptedCredentials = encryptPmsCredentials(credentials, encryptionKey);
  await prisma.tenantIntegration.upsert({
    where: { tenantId_provider: { tenantId, provider: provider as PrismaPmsProvider } },
    create: { tenantId, provider: provider as PrismaPmsProvider, status: "ACTIVE", encryptedCredentials },
    update: { status: "ACTIVE", encryptedCredentials }
  });
  await prisma.tenantConfig.update({
    where: { tenantId },
    data: { pmsProvider: provider as PrismaPmsProvider }
  });

  return {
    ok: true,
    provider,
    productCount: products.length,
    sampleTitles: products.slice(0, 5).map((product) => product.title)
  };
}

export type TenantIntegrationStatus = {
  provider: PmsProvider;
  status: string;
  updatedAt: string;
};

/** Current connected integrations for a tenant (no secrets returned). */
export async function getTenantIntegrationStatuses(tenantId: string): Promise<TenantIntegrationStatus[]> {
  const rows = await prisma.tenantIntegration.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" }
  });
  return rows.map((row) => ({
    provider: row.provider as PmsProvider,
    status: row.status,
    updatedAt: row.updatedAt.toISOString()
  }));
}
