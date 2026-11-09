import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeWhatsAppWebhook } from "./webhook-auth";

const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "628100", id: "wamid.1", text: { body: "accept:abc" } }] } }] }] });
const sign = (raw: string, secret: string) => `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
const prod = { NODE_ENV: "production", WHATSAPP_APP_SECRET: "app-secret", KAI_ADMIN_TOKEN: "admin-token" };
const base = { rawBody: body, signatureHeader: null, authorizationHeader: null };

describe("authorizeWhatsAppWebhook", () => {
  it("accepts a body signed with the app secret", () => {
    expect(authorizeWhatsAppWebhook({ ...base, signatureHeader: sign(body, "app-secret"), env: prod })).toEqual({ ok: true, via: "signature" });
  });

  it("rejects a missing, wrong, or other-body signature", () => {
    expect(authorizeWhatsAppWebhook({ ...base, env: prod })).toMatchObject({ ok: false });
    expect(authorizeWhatsAppWebhook({ ...base, signatureHeader: sign(body, "wrong"), env: prod })).toMatchObject({ ok: false });
    expect(authorizeWhatsAppWebhook({ ...base, signatureHeader: sign("{}", "app-secret"), env: prod })).toMatchObject({ ok: false });
  });

  it("accepts the service token, and rejects a wrong one", () => {
    expect(authorizeWhatsAppWebhook({ ...base, authorizationHeader: "Bearer admin-token", env: prod })).toEqual({ ok: true, via: "service_token" });
    expect(authorizeWhatsAppWebhook({ ...base, authorizationHeader: "Bearer nope", env: prod })).toMatchObject({ ok: false });
  });

  it("in production with no app secret refuses everything but the service token", () => {
    const env = { NODE_ENV: "production", KAI_ADMIN_TOKEN: "admin-token" };
    expect(authorizeWhatsAppWebhook({ ...base, signatureHeader: sign(body, ""), env })).toEqual({ ok: false, reason: "missing_app_secret" });
    expect(authorizeWhatsAppWebhook({ ...base, authorizationHeader: "Bearer admin-token", env })).toMatchObject({ ok: true });
  });

  it("accepts unsigned requests only while no app secret exists and the override is on", () => {
    const noSecret = { NODE_ENV: "production", KAI_ADMIN_TOKEN: "admin-token" };
    for (const flag of ["true", "True", "TRUE", " true "]) {
      expect(authorizeWhatsAppWebhook({ ...base, env: { ...noSecret, WHATSAPP_ALLOW_UNSIGNED: flag } })).toEqual({ ok: true, via: "unsigned_override" });
    }
    for (const flag of [undefined, "", "false", "1", "yes", '"true"']) {
      expect(authorizeWhatsAppWebhook({ ...base, env: { ...noSecret, WHATSAPP_ALLOW_UNSIGNED: flag } })).toEqual({ ok: false, reason: "missing_app_secret" });
    }
  });

  it("the override does nothing once an app secret is set: a wrong signature is still refused", () => {
    const env = { ...prod, WHATSAPP_ALLOW_UNSIGNED: "true" };
    expect(authorizeWhatsAppWebhook({ ...base, signatureHeader: sign(body, "wrong"), env })).toMatchObject({ ok: false });
    expect(authorizeWhatsAppWebhook({ ...base, env })).toMatchObject({ ok: false });
    expect(authorizeWhatsAppWebhook({ ...base, signatureHeader: sign(body, "app-secret"), env })).toEqual({ ok: true, via: "signature" });
  });

  it("outside production with no app secret skips the check", () => {
    expect(authorizeWhatsAppWebhook({ ...base, env: { NODE_ENV: "test" } })).toEqual({ ok: true, via: "dev_unverified" });
  });

  it("with an app secret set, a bad signature is refused even outside production", () => {
    expect(authorizeWhatsAppWebhook({ ...base, signatureHeader: "sha256=deadbeef", env: { NODE_ENV: "test", WHATSAPP_APP_SECRET: "s" } })).toMatchObject({ ok: false });
  });
});
