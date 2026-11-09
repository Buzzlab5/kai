import { createHmac, timingSafeEqual } from "node:crypto";

export type WhatsAppWebhookAuth =
  | { ok: true; via: "signature" | "service_token" | "dev_unverified" | "unsigned_override" }
  | { ok: false; reason: "missing_app_secret" | "invalid_credentials" };

function equalConstantTime(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Who may post to the WhatsApp webhook: Meta (valid `x-hub-signature-256` over the raw body, signed
 * with the app secret) or our own redesign app forwarding a copy (the same KAI_ADMIN_TOKEN bearer the
 * admin routes use). Production without WHATSAPP_APP_SECRET refuses everything rather than trusting
 * anyone; outside production a missing secret skips the check so local runs and the existing suites
 * keep working.
 */
export function authorizeWhatsAppWebhook(input: {
  rawBody: string;
  signatureHeader: string | null;
  authorizationHeader: string | null;
  env?: Record<string, string | undefined>;
}): WhatsAppWebhookAuth {
  const env = input.env ?? process.env;
  const appSecret = env.WHATSAPP_APP_SECRET?.trim() ?? "";
  const adminToken = env.KAI_ADMIN_TOKEN?.trim() ?? "";

  const bearer = input.authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (adminToken && bearer && equalConstantTime(bearer, adminToken)) {
    return { ok: true, via: "service_token" };
  }

  if (!appSecret) {
    // Stopgap for when the Meta app secret is not available yet: an explicit opt-in that only
    // applies while no secret is set. Once WHATSAPP_APP_SECRET exists it does nothing, so a
    // wrong signature is still refused. The route logs every message accepted this way.
    if (env.WHATSAPP_ALLOW_UNSIGNED?.trim() === "true") return { ok: true, via: "unsigned_override" };
    return env.NODE_ENV === "production"
      ? { ok: false, reason: "missing_app_secret" }
      : { ok: true, via: "dev_unverified" };
  }

  if (input.signatureHeader?.startsWith("sha256=")) {
    const expected = `sha256=${createHmac("sha256", appSecret).update(input.rawBody, "utf8").digest("hex")}`;
    if (equalConstantTime(expected, input.signatureHeader)) return { ok: true, via: "signature" };
  }

  return { ok: false, reason: "invalid_credentials" };
}
