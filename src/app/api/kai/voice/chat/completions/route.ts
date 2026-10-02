import { NextResponse, type NextRequest } from "next/server";
import { runKaiVoiceTurn, type VoiceTurnMessage } from "@/server/voice/voice-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kai as the brain behind a phone agent. The voice platform (ElevenLabs) does the listening and the
 * talking and calls this like any OpenAI chat-completions endpoint; every answer comes from Kai's
 * own flow, so a WhatsApp call knows the same catalogue, enquiry and rules as the chat.
 *
 * Point the agent's custom LLM server URL at https://<host>/api/kai/voice with the API key set to
 * KAI_VOICE_API_KEY. See docs/kai-voice-whatsapp.md.
 */
type ChatCompletionsBody = {
  messages?: VoiceTurnMessage[];
  stream?: boolean;
  model?: string;
  user?: string;
  /** ElevenLabs passes an agent's dynamic variables through here, e.g. the caller's number. */
  elevenlabs_extra_body?: Record<string, unknown>;
};

const fallbackSpokenReply =
  "Sorry, I've hit a snag on my end. Give me a moment and try again, or send me a message on WhatsApp and I'll pick it up there.";

export async function POST(request: NextRequest) {
  const expectedKey = process.env.KAI_VOICE_API_KEY?.trim();
  if (!expectedKey) {
    return NextResponse.json({ error: { message: "Voice endpoint is not configured." } }, { status: 503 });
  }
  if (readBearerToken(request) !== expectedKey) {
    return NextResponse.json({ error: { message: "Unauthorized." } }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ChatCompletionsBody | null;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: { message: "messages is required." } }, { status: 400 });
  }

  const callerPhone = readCallerPhone(request, body);
  const model = body?.model?.trim() || "kai";
  let spoken: string;

  try {
    const turn = await runKaiVoiceTurn({ messages, callerPhone });
    spoken = turn.spoken || fallbackSpokenReply;
    console.log("kai_voice.turn_answered", { conversationId: turn.conversationId, hasCaller: Boolean(callerPhone) });
  } catch (error) {
    // A caller is mid-sentence on a live call: say something human rather than failing the call.
    console.error("kai_voice.turn_failed", { error: error instanceof Error ? error.message : String(error) });
    spoken = fallbackSpokenReply;
  }

  return body?.stream === false ? NextResponse.json(buildCompletion(model, spoken)) : streamCompletion(model, spoken);
}

function readBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  return bearer || request.headers.get("x-api-key")?.trim() || null;
}

function readCallerPhone(request: NextRequest, body: ChatCompletionsBody | null) {
  const extra = body?.elevenlabs_extra_body ?? {};
  const candidates = [
    extra.caller_id,
    extra.caller_phone,
    extra.system__caller_id,
    extra.from_number,
    body?.user,
    request.headers.get("x-caller-phone")
  ];

  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof found === "string" ? found.trim() : null;
}

function buildCompletion(model: string, content: string) {
  return {
    id: `chatcmpl-kai-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
  };
}

function streamCompletion(model: string, content: string) {
  const id = `chatcmpl-kai-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\n\n`;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(chunk({ role: "assistant", content }, null)));
      controller.enqueue(encoder.encode(chunk({}, "stop")));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
