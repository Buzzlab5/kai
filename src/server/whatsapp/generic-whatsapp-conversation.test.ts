import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { handleGenericWhatsAppInboundMessage } from "./generic-whatsapp-conversation";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

function stubGraph() {
  process.env.META_GRAPH_VERSION = "v20.0";
  process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
  process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";
  process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";
  delete process.env.ENABLE_LLM;
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ messages: [{ id: "wamid.generic" }] }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentTexts(fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }) {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).includes("graph.facebook.com"))
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
    .filter((payload) => payload.type === "text");
}

describe("getting a person into an operator's WhatsApp chat", () => {
  it("promises a person, hands the chat to the operator's team, alerts them, then stays quiet", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `generic-handoff-${randomUUID()}`,
        name: "Boattime Yacht Charters",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://example.com"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["whatsapp"],
            enabledFeatures: [],
            requiredSlots: [],
            bookingMode: "AUTO_BOOKING",
            pmsProvider: "MOCK",
            escalationRules: [],
            responseGuardrails: [],
            adminWhatsAppPhone: "61400555444"
          }
        }
      },
      include: { config: true, branding: true }
    });
    const fetchMock = stubGraph();
    const from = `6143${String(Date.now()).slice(-8)}`;

    const handoff = await handleGenericWhatsAppInboundMessage({ from, providerMessageId: "wamid.g1", body: "can I talk to a real person?" }, tenant);

    expect(handoff.reply).toBe(
      "Of course, I'll get a person from the team to jump into this chat as soon as possible, and nothing gets booked or changed in the meantime."
    );
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(conversation.controlMode).toBe("HUMAN");
    expect(sentTexts(fetchMock).some((payload) => payload.to === "61400555444" && payload.text.body.includes("asked for a person"))).toBe(true);

    const sendsBefore = sentTexts(fetchMock).length;
    const quiet = await handleGenericWhatsAppInboundMessage({ from, providerMessageId: "wamid.g2", body: "still there?" }, tenant);
    expect(quiet).toEqual({ handled: true, sent: false, reply: null });
    expect(sentTexts(fetchMock).length).toBe(sendsBefore);
  }, 30_000);
});
