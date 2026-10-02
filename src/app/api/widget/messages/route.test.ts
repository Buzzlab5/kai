import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("widget: getting a person on the web", () => {
  it("asks for their WhatsApp, then passes it to the team", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";
    process.env.WHATSAPP_PHONE_ID_OPS = "2225079071692326";
    delete process.env.ENABLE_LLM;
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ messages: [{ id: "wamid.web.alert" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-web-handoff-${randomUUID()}`,
        name: "BluePass",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE",
        config: {
          create: {
            supportedChannels: ["web"],
            enabledFeatures: ["bluepass_marketplace"],
            requiredSlots: [],
            bookingMode: "MANUAL_INQUIRY",
            escalationRules: [],
            responseGuardrails: [],
            adminWhatsAppPhone: "61400333222"
          }
        }
      }
    });
    const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB", controlMode: "AI" } });
    const send = (content: string) =>
      POST(
        new NextRequest("http://localhost/api/widget/messages", {
          method: "POST",
          headers: { origin: "https://bluepass.co", "content-type": "application/json" },
          body: JSON.stringify({ key: tenant.widgetPublicKey, conversationId: conversation.id, content })
        })
      ).then((response) => response.json());
    const alerts = () =>
      fetchMock.mock.calls
        .filter((call) => String(call[0]).includes("2225079071692326"))
        .map((call) => JSON.parse(String((call[1] as RequestInit).body)).text.body as string);

    const asked = await send("can I talk to a real person?");
    expect(asked.assistantMessage.content).toBe(
      "Of course, I'll get a person from the BluePass team onto this as soon as possible. What's the best WhatsApp number for them to reach you on?"
    );
    expect(alerts().at(-1)).toContain("Kai has asked for their WhatsApp number");

    const number = await send("sure, it's +61 400 111 222");
    expect(number.assistantMessage.content).toBe(
      "Thanks, I've passed +61 400 111 222 to the BluePass team, and a person will message you on WhatsApp as soon as possible."
    );
    expect(alerts().at(-1)).toContain("left their WhatsApp: +61 400 111 222");

    // Nobody can reply into the web widget, so Kai carries on there.
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.controlMode).toBe("AI");
  }, 30_000);
});
