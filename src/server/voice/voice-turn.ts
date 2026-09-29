import { toSpokenReply } from "@/core/voice/spoken-reply";
import { prisma } from "@/lib/prisma";
import {
  createAssistantMessage,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createBluePassRouterClient } from "@/server/llm/bluepass-router-client";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { composeBluePassMarketplaceAssistantReply } from "@/server/bluepass/bluepass-marketplace-reply-composer";
import { shouldPolishBluePassMarketplaceReply } from "@/server/bluepass/bluepass-marketplace-reply-gate";
import { handleBluePassMarketplaceMessage } from "@/server/bluepass/bluepass-message-flow";

/**
 * One turn of a voice call with Kai. The voice itself (listening and speaking) belongs to the phone
 * agent; every word Kai says comes from the same brain as the WhatsApp and web chats, so a call
 * knows the same catalogue, the same enquiry and the same rules. A caller Kai already knows by
 * number carries on in their existing conversation, so a call and a chat are one thread.
 */
export type VoiceTurnMessage = { role: "system" | "user" | "assistant"; content: string };

export type VoiceTurnResult = {
  /** What Kai would write. */
  reply: string;
  /** The same answer, as it should be read out loud. */
  spoken: string;
  conversationId: string | null;
};

const defaultBluePassTenantSlug = "bluepass";

export async function runKaiVoiceTurn(input: {
  messages: VoiceTurnMessage[];
  /** The caller's number, so a call continues their existing chat. */
  callerPhone?: string | null;
}): Promise<VoiceTurnResult> {
  const latestMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content?.trim();
  if (!latestMessage) {
    return { reply: "", spoken: "", conversationId: null };
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: process.env.WHATSAPP_BLUEPASS_TENANT_SLUG?.trim() || defaultBluePassTenantSlug, status: "ACTIVE" }
  });
  if (!tenant) {
    throw new Error("No active BluePass tenant is configured for voice calls.");
  }

  const callerPhone = input.callerPhone?.trim() ? normalizeLocalPhone(input.callerPhone) : null;
  // A known number keeps its own thread; an unknown caller's turn runs off the history the phone
  // agent sends with the request, and isn't written to anyone's conversation.
  const conversation = callerPhone
    ? await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: callerPhone })
    : null;

  const priorTravellerMessages = conversation
    ? await listRecentTravellerMessageContents({ tenantId: tenant.id, conversationId: conversation.id })
    : input.messages.filter((message) => message.role === "user").map((message) => message.content).slice(0, -1);

  if (conversation) {
    await createTravellerMessage({ tenantId: tenant.id, conversationId: conversation.id, content: latestMessage });
  }

  const result = await handleBluePassMarketplaceMessage({
    tenantId: tenant.id,
    conversationId: conversation?.id ?? `voice-${tenant.id}`,
    content: latestMessage,
    priorTravellerMessages,
    travellerPhone: callerPhone,
    routerClient: createBluePassRouterClient(process.env)
  });

  const shouldPolish = shouldPolishBluePassMarketplaceReply({ persona: result.persona, replyMode: result.replyMode });
  const history = conversation
    ? await listRecentConversationMessages({ tenantId: tenant.id, conversationId: conversation.id })
    : input.messages.map((message) => ({
        role: message.role === "assistant" ? ("assistant" as const) : ("traveller" as const),
        content: message.content
      }));
  const composed = await composeBluePassMarketplaceAssistantReply({
    deterministicReply: result.assistantContent,
    latestMessage,
    conversationHistory: history,
    llmClient: shouldPolish ? createAssistantLlmClient(process.env) : null,
    marketplaceResult: result
  });

  if (conversation) {
    await createAssistantMessage({ tenantId: tenant.id, conversationId: conversation.id, content: composed.reply });
  }

  return { reply: composed.reply, spoken: toSpokenReply(composed.reply), conversationId: conversation?.id ?? null };
}
