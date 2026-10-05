import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { alertTeam, buildTeamAlertBody, teamAlertReasonFor } from "./team-alert";
import { findKaiStyleBreaches } from "@/core/llm/kai-persona";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

async function createTenant(adminWhatsAppPhone: string | null) {
  return prisma.tenant.create({
    data: {
      slug: `team-alert-${randomUUID()}`,
      name: "Boattime Yacht Charters",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.com"],
      status: "ACTIVE",
      config: {
        create: {
          supportedChannels: ["whatsapp"],
          enabledFeatures: [],
          requiredSlots: [],
          bookingMode: "MANUAL_INQUIRY",
          escalationRules: [],
          responseGuardrails: [],
          adminWhatsAppPhone
        }
      }
    }
  });
}

function stubGraph() {
  process.env.META_GRAPH_VERSION = "v20.0";
  process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
  process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";
  process.env.WHATSAPP_PHONE_ID_OPS = "2225079071692326";
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ messages: [{ id: "wamid.alert" }] }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("alertTeam", () => {
  it("messages the tenant's admin WhatsApp from the ops number", async () => {
    const tenant = await createTenant("61400999888");
    const fetchMock = stubGraph();

    const result = await alertTeam({
      tenantId: tenant.id,
      conversationId: "conversation_1",
      reason: "PERSON_REQUESTED",
      channel: "whatsapp",
      travellerPhone: "61400111222",
      latestMessage: "can I talk to a real person?"
    });

    expect(result.sent).toBe(true);
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes("2225079071692326"));
    const payload = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(payload.to).toBe("61400999888");
    expect(payload.text.body).toContain("asked for a person in the Boattime Yacht Charters chat");
    expect(payload.text.body).toContain("Kai has gone quiet on that chat");
  });

  it("also posts to a webhook when one is set, for Slack or email", async () => {
    const tenant = await createTenant(null);
    const webhook = vi.fn<typeof fetch>(async () => new Response("ok"));

    const result = await alertTeam(
      {
        tenantId: tenant.id,
        conversationId: "conversation_2",
        reason: "EMERGENCY",
        channel: "web",
        latestMessage: "my friend is injured"
      },
      { KAI_TEAM_ALERT_WEBHOOK_URL: "https://hooks.example.com/kai" },
      webhook
    );

    expect(result.sent).toBe(true);
    const body = JSON.parse(String((webhook.mock.calls[0][1] as RequestInit).body));
    expect(body.text.startsWith("Kai URGENT:")).toBe(true);
  });

  it("never throws when nowhere is set up to receive it", async () => {
    const tenant = await createTenant(null);

    await expect(
      alertTeam({ tenantId: tenant.id, conversationId: "c", reason: "PERSON_REQUESTED", channel: "web", latestMessage: "human please" }, {})
    ).resolves.toEqual({ sent: false });
  });
});

describe("buildTeamAlertBody", () => {
  it("says what happened, what Kai did and what the team should do, without dashes or emojis", () => {
    for (const reason of ["PERSON_REQUESTED", "CALLBACK_NUMBER", "EMERGENCY"] as const) {
      for (const channel of ["whatsapp", "web"] as const) {
        const body = buildTeamAlertBody({
          reason,
          channel,
          tenantName: "BluePass",
          travellerPhone: "61400111222",
          callbackNumber: "+61 400 111 222",
          latestMessage: "can I talk to a real person?",
          transcriptUrl: "https://kai.example.com/admin/bluepass/conversations/c1"
        });
        expect(body, body).not.toMatch(/[–—]|\p{Extended_Pictographic}/u);
        expect(body).toContain("Transcript: https://kai.example.com/admin/bluepass/conversations/c1");
      }
    }
  });
});

// The alert copy is for the team, but it still shouldn't break Kai's style rules.
describe("team alert voice", () => {
  it("passes Kai's style lint apart from quoting the traveller", () => {
    const body = buildTeamAlertBody({ reason: "CALLBACK_NUMBER", channel: "web", tenantName: "BluePass", callbackNumber: "+61 400 111 222", latestMessage: "" });
    expect(findKaiStyleBreaches(body)).toEqual([]);
  });
});

describe("team alerts for phone calls", () => {
  const base = { tenantName: "BluePass", latestMessage: "my friend is badly hurt", travellerPhone: "+61 400 111 222" };

  it("tells the team to call back now when a caller may be hurt", () => {
    const body = buildTeamAlertBody({ ...base, reason: "EMERGENCY", channel: "voice" });

    expect(body).toContain("Kai URGENT");
    expect(body).toContain("a caller (+61 400 111 222)");
    expect(body).toContain("call 000");
    expect(body).toContain("Please call them back now.");
    expect(findKaiStyleBreaches(body)).toEqual([]);
  });

  it("says when a caller's number is unknown, and asks the team to call or message them", () => {
    const body = buildTeamAlertBody({ ...base, travellerPhone: null, reason: "PERSON_REQUESTED", channel: "voice" });

    expect(body).toContain("a caller (number unknown)");
    expect(body).toContain("asked for a person");
    expect(body).toContain("call or message them");
    expect(findKaiStyleBreaches(body)).toEqual([]);
  });

  it("passes on the WhatsApp number a caller leaves", () => {
    const body = buildTeamAlertBody({ ...base, callbackNumber: "+61 400 999 000", reason: "CALLBACK_NUMBER", channel: "voice" });

    expect(body).toContain("+61 400 999 000");
    expect(body).toContain("message them as soon as possible");
  });

  it("maps a reply's team signals to the right alert, and to none for an ordinary reply", () => {
    expect(teamAlertReasonFor({ emergency: true, humanHandoff: "REQUESTED" })).toBe("EMERGENCY");
    expect(teamAlertReasonFor({ humanHandoff: "CALLBACK_NUMBER" })).toBe("CALLBACK_NUMBER");
    expect(teamAlertReasonFor({ humanHandoff: "REQUESTED" })).toBe("PERSON_REQUESTED");
    expect(teamAlertReasonFor({})).toBeNull();
    expect(teamAlertReasonFor({ emergency: false })).toBeNull();
  });
});
