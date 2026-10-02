# Calling Kai on WhatsApp

You ring a WhatsApp number and talk to Kai. The voice platform (ElevenLabs) does the listening and
the speaking; every word Kai says comes from this app, so a call knows the same catalogue, the same
enquiry and the same rules as the WhatsApp and web chats. Kai recognises the caller's number and
carries on in the conversation they already have in text.

## How it fits together

```
caller ── WhatsApp voice call ──► ElevenLabs agent ──► POST /api/kai/voice/chat/completions ──► Kai
                                  (speech in/out)      (OpenAI-shaped, this app)        (BluePass flow)
```

ElevenLabs is pointed at this app as a "custom LLM", so it never invents an answer of its own: it
sends the transcript, this endpoint runs Kai's real flow and returns the words to speak.

## Use a second number, not Kai's existing one

ElevenLabs can only take a WhatsApp number that isn't registered with another provider or in use in
the WhatsApp Business app. Kai's current number is registered to our own Meta Cloud API app and runs
operator dispatch, the approved templates and delivery statuses, so importing it into ElevenLabs
would take all of that with it. Use a separate number for voice and leave text where it is.

ElevenLabs also lists WhatsApp human handoff as "coming soon", which is another reason to keep text
on our own number, where the handoff to a person already works.

## Setting it up

1. **Get a number** that has never been used on WhatsApp and can receive a verification code.
2. **ElevenLabs → Agents → WhatsApp → Import account**, and complete the Meta authorisation flow.
3. **Assign an agent** to the imported account. Without one, inbound calls are rejected.
4. **WhatsApp Manager → Phone numbers → your number → Call settings**: turn calling on (add a
   payment method there if you also want Kai to make outbound calls).
5. **Point the agent at Kai.** In the agent's LLM settings choose a custom LLM:
   - Server URL: `https://<this app>/api/kai/voice`
   - Model: `kai`
   - API key: the value of `KAI_VOICE_API_KEY` below
6. **Pass the caller's number through** as a dynamic variable named `caller_id` (the endpoint also
   accepts `caller_phone`, `system__caller_id`, `from_number`, OpenAI's `user` field, or an
   `x-caller-phone` header). Without it Kai still answers, but the call won't be tied to their chat.
7. **Pick a voice.** Kai is a well-travelled Australian, so an Australian-accented voice fits; keep
   it consistent once chosen, because it becomes Kai's voice.

## Environment

| Variable | What it's for |
| --- | --- |
| `KAI_VOICE_API_KEY` | Shared secret the agent sends as `Authorization: Bearer ...`. Without it the endpoint returns 503, so it is never open. |
| `WHATSAPP_BLUEPASS_TENANT_SLUG` | Which tenant a call belongs to (defaults to `bluepass`). |

The LLM and router keys already used by the chat flows apply to calls too: with them set, replies go
through the same rewrite as text, and without them Kai falls back to its scripted answers.

## What the endpoint does

- `POST /api/kai/voice/chat/completions` speaks OpenAI's chat-completions shape, streaming by
  default (`stream: false` returns plain JSON). Only the words change: the answers come from
  `handleBluePassMarketplaceMessage`, the same entry point WhatsApp and the widget use.
- Answers are rewritten for the ear (`src/core/voice/spoken-reply.ts`): links dropped, numbered
  lists read as sentences, "A$79" said as "79 Australian dollars". Facts are never changed.
- A known caller's turns are saved to their conversation, so a call and a chat are one thread and
  the team sees both in the admin transcript. An unknown caller still gets answers; nothing is
  written to anyone's chat.
- If Kai's brain fails mid-call, the caller hears "Sorry, I've hit a snag on my end..." rather than
  the call dropping.

## Limits worth knowing

- WhatsApp Flows aren't sent, and video messages don't reach the agent.
- Audio in and out is billed by ElevenLabs as speech-to-text and text-to-speech on top of agent
  minutes.
- Anything Kai won't do in text (invent availability, take card details, quote a commission split)
  it won't do on a call either: it's the same brain and the same house rules.
