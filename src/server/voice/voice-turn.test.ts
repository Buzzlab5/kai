import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { alertTeam } from "@/server/conversation/team-alert";
import { runKaiVoiceTurn } from "./voice-turn";

// The real alert would WhatsApp the team's phone; these tests only need to know it was asked for.
vi.mock("@/server/conversation/team-alert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/conversation/team-alert")>()),
  alertTeam: vi.fn(async () => ({ sent: true }))
}));

const originalEnv = { ...process.env };

afterEach(() => {
  vi.mocked(alertTeam).mockClear();
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
  // A caller was told someone is on the way, or to call 000, with nobody told: the same "promised and
  // nothing happened" gap the chat flows closed, found reading the voice turn after PR 8.
  it("alerts the team when a known caller may be hurt", async () => {
    const tenant = await createBluePassTenant();

    const turn = await runKaiVoiceTurn({
      messages: [{ role: "user", content: "there's been an accident and my friend is injured" }],
      callerPhone: "+61 400 555 666"
    });

    expect(turn.spoken).toContain("000");
    expect(alertTeam).toHaveBeenCalledTimes(1);
    expect(alertTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant.id,
        reason: "EMERGENCY",
        channel: "voice",
        conversationId: turn.conversationId,
        latestMessage: "there's been an accident and my friend is injured"
      })
    );
  }, 30_000);

  it("alerts the team when an unknown caller asks for a person, with no chat to link to", async () => {
    await createBluePassTenant();

    const turn = await runKaiVoiceTurn({ messages: [{ role: "user", content: "can I talk to a real person?" }] });

    expect(turn.spoken.toLowerCase()).toContain("person");
    expect(alertTeam).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "PERSON_REQUESTED", channel: "voice", conversationId: null, travellerPhone: null })
    );
  }, 30_000);

  it("does not alert the team for an ordinary question", async () => {
    await createBluePassTenant();

    await runKaiVoiceTurn({ messages: [{ role: "user", content: "when's the best time to go to Komodo?" }], callerPhone: "+61 400 777 888" });

    expect(alertTeam).not.toHaveBeenCalled();
  }, 30_000);
});
