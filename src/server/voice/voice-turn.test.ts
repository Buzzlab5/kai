import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runKaiVoiceTurn } from "./voice-turn";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

async function createBluePassTenant() {
  const slug = `bluepass-voice-${randomUUID()}`;
  process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = slug;
  delete process.env.ENABLE_LLM;

  return prisma.tenant.create({
    data: {
      slug,
      name: "BluePass",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE",
      config: {
        create: {
          supportedChannels: ["whatsapp"],
          enabledFeatures: ["bluepass_marketplace"],
          requiredSlots: [],
          bookingMode: "MANUAL_INQUIRY",
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
}

describe("runKaiVoiceTurn", () => {
  it("answers a caller with Kai's own brain, in words that read well aloud", async () => {
    await createBluePassTenant();

    const turn = await runKaiVoiceTurn({
      messages: [{ role: "user", content: "what boats have you got in Komodo?" }],
      callerPhone: "+61 400 111 222"
    });

    expect(turn.reply).toContain("Alila Purnama");
    expect(turn.spoken).toContain("Alila Purnama");
    // A call is no place for links or numbered rows.
    expect(turn.spoken).not.toContain("http");
    expect(turn.spoken).not.toMatch(/\n|^\d\./m);
  }, 30_000);

  it("keeps a caller's call and their chat as one conversation", async () => {
    const tenant = await createBluePassTenant();
    const callerPhone = "+61 400 333 444";

    const first = await runKaiVoiceTurn({ messages: [{ role: "user", content: "I'm looking at Komodo liveaboards" }], callerPhone });
    const second = await runKaiVoiceTurn({ messages: [{ role: "user", content: "what's the best time to go?" }], callerPhone });

    expect(second.conversationId).toBe(first.conversationId);
    const messages = await prisma.message.findMany({ where: { conversationId: first.conversationId ?? "" }, orderBy: { createdAt: "asc" } });
    // Both turns of the call are in the same thread as their WhatsApp chat.
    expect(messages.map((message) => message.role)).toEqual(["TRAVELLER", "ASSISTANT", "TRAVELLER", "ASSISTANT"]);
    expect(messages[0].content).toBe("I'm looking at Komodo liveaboards");
  }, 30_000);

  it("still answers an unknown caller, without writing to anyone's chat", async () => {
    await createBluePassTenant();

    const turn = await runKaiVoiceTurn({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hey, I'm Kai." },
        { role: "user", content: "when's the best time to go to Komodo?" }
      ]
    });

    expect(turn.conversationId).toBeNull();
    expect(turn.spoken.toLowerCase()).toContain("april");
  }, 30_000);
});
