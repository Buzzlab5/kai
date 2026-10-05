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
  // First ElevenLabs test call, 2026-10-05: Kai asked "what's the best WhatsApp number?", the caller
  // read it out, and Kai answered with the boat list again because the voice turn never told the flow
  // what Kai's last message was.
  it("takes the WhatsApp number an unknown caller reads out, and tells the team", async () => {
    await createBluePassTenant();
    const ask = "Of course, I'll get a person from the BluePass team onto this as soon as possible. What's the best WhatsApp number for them to reach you on?";

    const turn = await runKaiVoiceTurn({
      messages: [
        { role: "user", content: "can I talk to a real person?" },
        { role: "assistant", content: ask },
        { role: "user", content: "It's 085-337-210-180." }
      ]
    });

    expect(turn.spoken).toContain("085-337-210-180");
    expect(turn.spoken.toLowerCase()).toContain("message you on whatsapp");
    expect(turn.spoken).not.toContain("Alila Purnama");
    expect(alertTeam).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "CALLBACK_NUMBER", channel: "voice", callbackNumber: "085-337-210-180" })
    );
  }, 30_000);

  it("takes a yes to Kai's offer of a person as a request for one", async () => {
    await createBluePassTenant();

    await runKaiVoiceTurn({
      messages: [
        { role: "user", content: "are you a bot?" },
        { role: "assistant", content: "I'm Kai, BluePass's AI concierge, so not a person, but I'll always be straight with you. Want me to get a person from the team to jump in?" },
        { role: "user", content: "yes please" }
      ]
    });

    expect(alertTeam).toHaveBeenCalledWith(expect.objectContaining({ reason: "PERSON_REQUESTED", channel: "voice" }));
  }, 30_000);
});
