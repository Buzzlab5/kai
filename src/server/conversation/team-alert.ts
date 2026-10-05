import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/server/whatsapp/client";

export type TeamAlertReason = "PERSON_REQUESTED" | "CALLBACK_NUMBER" | "EMERGENCY";

/** The alert a reply's team signals call for, if any. Shared so every channel reads them the same way. */
export function teamAlertReasonFor(signals: { emergency?: boolean; humanHandoff?: string }): TeamAlertReason | null {
  if (signals.emergency) return "EMERGENCY";
  if (signals.humanHandoff === "CALLBACK_NUMBER") return "CALLBACK_NUMBER";
  if (signals.humanHandoff === "REQUESTED") return "PERSON_REQUESTED";
  return null;
}

/**
 * Tells the team a chat needs a person: someone asked for one, left a WhatsApp number for one, or
 * may be hurt. Same channel as the other Kai alerts (a WhatsApp from the ops number to the tenant's
 * admin number), plus an optional webhook for Slack, or Zapier to email. Best effort: an alert never
 * fails or delays the traveller's reply, and a missing destination is logged, not thrown.
 */
export async function alertTeam(
  input: {
    tenantId: string;
    /** Null for a caller Kai doesn't know by number: there is no chat to link to. */
    conversationId: string | null;
    reason: TeamAlertReason;
    channel: "whatsapp" | "web" | "voice";
    travellerPhone?: string | null;
    callbackNumber?: string | null;
    latestMessage: string;
  },
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch
): Promise<{ sent: boolean }> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { slug: true, name: true, config: { select: { adminWhatsAppPhone: true } } }
    });
    if (!tenant) return { sent: false };

    const body = buildTeamAlertBody({ ...input, tenantName: tenant.name, transcriptUrl: input.conversationId ? transcriptUrl(env, tenant.slug, input.conversationId) : null });
    const adminPhone = tenant.config?.adminWhatsAppPhone?.trim() || env.KAI_TEAM_ALERT_WHATSAPP?.trim();
    const webhookUrl = env.KAI_TEAM_ALERT_WEBHOOK_URL?.trim();
    let sent = false;

    if (adminPhone) {
      await sendWhatsAppText({ to: adminPhone, role: "ops", body })
        .then(() => {
          sent = true;
        })
        .catch((error) => console.error("kai_team_alert.whatsapp_failed", { reason: input.reason, error: String(error) }));
    }

    if (webhookUrl) {
      await fetcher(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // "text" for Slack, "content" for Discord; Zapier and friends take either.
        body: JSON.stringify({ text: body, content: body, reason: input.reason, tenant: tenant.slug, conversationId: input.conversationId })
      })
        .then((response) => {
          if (response.ok) sent = true;
          else console.error("kai_team_alert.webhook_failed", { reason: input.reason, status: response.status });
        })
        .catch((error) => console.error("kai_team_alert.webhook_failed", { reason: input.reason, error: String(error) }));
    }

    if (!adminPhone && !webhookUrl) {
      console.error("kai_team_alert.no_destination_configured", { tenantSlug: tenant.slug, reason: input.reason });
    }

    return { sent };
  } catch (error) {
    console.error("kai_team_alert.failed", { reason: input.reason, error: String(error) });
    return { sent: false };
  }
}

export function buildTeamAlertBody(input: {
  reason: TeamAlertReason;
  channel: "whatsapp" | "web" | "voice";
  tenantName: string;
  travellerPhone?: string | null;
  callbackNumber?: string | null;
  latestMessage: string;
  transcriptUrl?: string | null;
}) {
  const quoted = `"${input.latestMessage.trim().slice(0, 280)}"`;
  const transcript = input.transcriptUrl ? ` Transcript: ${input.transcriptUrl}` : "";

  if (input.channel === "voice") {
    // A live call: the person is waiting on the line, so the ask is to call or message them now.
    const caller = `a caller (${input.travellerPhone ?? "number unknown"})`;

    if (input.reason === "EMERGENCY") {
      return `Kai URGENT: ${caller} on the ${input.tenantName} line may be hurt or in danger: ${quoted}. Kai told them to call 000 (112 in Indonesia). Please call them back now.${transcript}`;
    }

    if (input.reason === "CALLBACK_NUMBER") {
      return `Kai alert: a caller on the ${input.tenantName} line who asked for a person left their WhatsApp: ${input.callbackNumber}. Please message them as soon as possible.${transcript}`;
    }

    return `Kai alert: ${caller} on the ${input.tenantName} line asked for a person: ${quoted}. Kai told them someone from the team would jump in, so please call or message them as soon as you can.${transcript}`;
  }

  if (input.reason === "EMERGENCY") {
    const who = input.channel === "whatsapp" && input.travellerPhone ? `on WhatsApp (${input.travellerPhone})` : "on the web chat";
    return `Kai URGENT: someone ${who} in the ${input.tenantName} chat may be hurt or in danger: ${quoted}. Kai told them to call 000 (112 in Indonesia). Please check on them now.${transcript}`;
  }

  if (input.reason === "CALLBACK_NUMBER") {
    return `Kai alert: the web visitor in the ${input.tenantName} chat who asked for a person left their WhatsApp: ${input.callbackNumber}. Please message them as soon as possible.${transcript}`;
  }

  return input.channel === "whatsapp"
    ? `Kai alert: a traveller on WhatsApp (${input.travellerPhone ?? "number unknown"}) asked for a person in the ${input.tenantName} chat: ${quoted}. Kai has gone quiet on that chat, so reply from the WhatsApp Business app, and hand it back to Kai from the admin page when you're done.${transcript}`
    : `Kai alert: a visitor on the ${input.tenantName} web chat asked for a person: ${quoted}. Kai has asked for their WhatsApp number and will send it through when they reply.${transcript}`;
}

function transcriptUrl(env: Record<string, string | undefined>, tenantSlug: string, conversationId: string) {
  const base = env.KAI_APP_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/admin/${tenantSlug}/conversations/${conversationId}` : null;
}
