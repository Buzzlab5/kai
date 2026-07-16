import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { PmsProvider as PrismaPmsProvider } from "@prisma/client";
import type { PmsProvider } from "@/core/tenant/types";

export type PmsAdapterEnvironment = Record<string, string | undefined>;

const ALGORITHM = "aes-256-gcm";

function resolveEncryptionKey(encryptionKey: string) {
  const key = Buffer.from(encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("PMS_CREDENTIAL_ENCRYPTION_KEY must decode to a 32-byte key.");
  }

  return key;
}

export function encryptPmsCredentials(payload: Record<string, string>, encryptionKey: string): string {
  const key = resolveEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptPmsCredentials(encrypted: string, encryptionKey: string): Record<string, string> {
  const key = resolveEncryptionKey(encryptionKey);
  const [ivPart, authTagPart, ciphertextPart] = encrypted.split(".");

  if (!ivPart || !authTagPart || !ciphertextPart) {
    throw new Error("Malformed encrypted PMS credential payload.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64")), decipher.final()]);

  return JSON.parse(plaintext.toString("utf8"));
}

function credentialsToRezdyEnv(credentials: Record<string, string>): PmsAdapterEnvironment {
  return {
    REZDY_BASE_URL: credentials.baseUrl,
    REZDY_API_KEY: credentials.apiKey,
    ...(credentials.productListPath ? { REZDY_PRODUCT_LIST_PATH: credentials.productListPath } : {}),
    ...(credentials.availabilityPath ? { REZDY_AVAILABILITY_PATH: credentials.availabilityPath } : {}),
    ...(credentials.bookingPath ? { REZDY_BOOKING_PATH: credentials.bookingPath } : {}),
    ...(credentials.timeoutMs ? { REZDY_TIMEOUT_MS: credentials.timeoutMs } : {})
  };
}

function credentialsToFareHarborEnv(credentials: Record<string, string>): PmsAdapterEnvironment {
  return {
    FAREHARBOR_BASE_URL: credentials.baseUrl,
    FAREHARBOR_APP_KEY: credentials.appKey,
    FAREHARBOR_USER_KEY: credentials.userKey,
    FAREHARBOR_COMPANY_SHORTNAME: credentials.companyShortname,
    ...(credentials.timeoutMs ? { FAREHARBOR_TIMEOUT_MS: credentials.timeoutMs } : {})
  };
}

// Per-tenant credential -> adapter-env mappers. A provider only participates in the
// per-tenant path (self-serve "Connect") once it appears here.
const CREDENTIAL_ENV_MAPPERS: Partial<
  Record<PmsProvider, (credentials: Record<string, string>) => PmsAdapterEnvironment>
> = {
  REZDY: credentialsToRezdyEnv,
  FAREHARBOR: credentialsToFareHarborEnv
};

/** Providers an operator can self-connect (paste credentials) via the "Connect" flow. */
export function connectablePmsProviders(): PmsProvider[] {
  return Object.keys(CREDENTIAL_ENV_MAPPERS) as PmsProvider[];
}

/** Map submitted credentials to adapter env for a connectable provider. Throws if unsupported. */
export function pmsCredentialsToEnv(
  provider: PmsProvider,
  credentials: Record<string, string>
): PmsAdapterEnvironment {
  const toEnv = CREDENTIAL_ENV_MAPPERS[provider];
  if (!toEnv) {
    throw new Error(`Provider ${provider} does not support per-tenant credentials yet.`);
  }
  return toEnv(credentials);
}

/** The credential fields each connectable provider needs, for building the connect form. */
export const PMS_CREDENTIAL_FIELDS: Partial<Record<PmsProvider, Array<{ key: string; label: string; required: boolean }>>> = {
  REZDY: [
    { key: "apiKey", label: "Rezdy API key", required: true },
    { key: "baseUrl", label: "Rezdy API base URL (default https://api.rezdy.com)", required: false }
  ],
  FAREHARBOR: [
    { key: "appKey", label: "FareHarbor API App key (X-FareHarbor-API-App)", required: true },
    { key: "userKey", label: "FareHarbor API User key (X-FareHarbor-API-User)", required: true },
    { key: "companyShortname", label: "FareHarbor company shortname", required: true },
    { key: "baseUrl", label: "FareHarbor base URL (default https://fareharbor.com/api/external/v1)", required: false }
  ]
};

/**
 * Prefers a tenant's own encrypted TenantIntegration credentials over the shared global env vars.
 * Falls back to fallbackEnv (unchanged) whenever no active per-tenant row exists, so tenants without
 * one (e.g. boattime today) keep behaving exactly as before this existed.
 */
export async function resolveTenantPmsEnv(
  tenantId: string,
  provider: PmsProvider,
  fallbackEnv: PmsAdapterEnvironment
): Promise<PmsAdapterEnvironment> {
  const toEnv = CREDENTIAL_ENV_MAPPERS[provider];
  if (!toEnv) {
    return fallbackEnv;
  }

  const encryptionKey = process.env.PMS_CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return fallbackEnv;
  }

  try {
    const integration = await prisma.tenantIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: provider as PrismaPmsProvider } }
    });

    if (!integration || integration.status !== "ACTIVE") {
      return fallbackEnv;
    }

    const credentials = decryptPmsCredentials(integration.encryptedCredentials, encryptionKey);
    return { ...fallbackEnv, ...toEnv(credentials) };
  } catch (error) {
    console.error("tenant_pms_credentials.resolve_failed", {
      tenantId,
      provider,
      error: error instanceof Error ? error.message : String(error)
    });
    return fallbackEnv;
  }
}
