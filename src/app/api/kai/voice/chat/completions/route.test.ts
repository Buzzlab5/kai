import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runKaiVoiceTurn = vi.hoisted(() => vi.fn());
vi.mock("@/server/voice/voice-turn", () => ({ runKaiVoiceTurn }));

import { POST } from "./route";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.KAI_VOICE_API_KEY = "voice-secret";
  runKaiVoiceTurn.mockReset();
  runKaiVoiceTurn.mockResolvedValue({ reply: "Komodo runs April to November.", spoken: "Komodo runs April to November.", conversationId: "c1" });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function post(body: unknown, headers: Record<string, string> = { authorization: "Bearer voice-secret" }) {
  return POST(
    new NextRequest("http://localhost/api/kai/voice/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    })
  );
}

describe("POST /api/kai/voice/chat/completions", () => {
  it("streams Kai's answer in the shape a voice agent expects", async () => {
    const response = await post({ model: "kai", stream: true, messages: [{ role: "user", content: "when should I go to Komodo?" }] });
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const chunks = body
      .split("\n\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.replace("data: ", "")));
    expect(chunks[0].object).toBe("chat.completion.chunk");
    expect(chunks[0].choices[0].delta.content).toBe("Komodo runs April to November.");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("answers without streaming when asked to", async () => {
    const response = await post({ stream: false, messages: [{ role: "user", content: "hi" }] });
    const body = await response.json();

    expect(body.choices[0].message).toEqual({ role: "assistant", content: "Komodo runs April to November." });
  });

  it("passes the caller's number through, so a call continues their chat", async () => {
    await post({
      stream: true,
      messages: [{ role: "user", content: "hi" }],
      elevenlabs_extra_body: { caller_id: "+61400111222" }
    });

    expect(runKaiVoiceTurn.mock.calls[0][0].callerPhone).toBe("+61400111222");
  });

  it("refuses without the right key, and says so when no key is configured", async () => {
    expect((await post({ messages: [{ role: "user", content: "hi" }] }, { authorization: "Bearer wrong" })).status).toBe(401);

    delete process.env.KAI_VOICE_API_KEY;
    expect((await post({ messages: [{ role: "user", content: "hi" }] })).status).toBe(503);
  });

  it("says something human when Kai's brain fails mid-call, rather than dropping the call", async () => {
    runKaiVoiceTurn.mockRejectedValue(new Error("database is down"));

    const response = await post({ stream: true, messages: [{ role: "user", content: "hi" }] });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Sorry, I've hit a snag on my end.");
  });
});
