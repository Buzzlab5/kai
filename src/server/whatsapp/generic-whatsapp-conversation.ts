import { runGenericBookingTurn, type GenericBookingTurnTenant } from "@/server/booking/generic-booking-turn";
import {
  createAssistantMessage,
  createTravellerMessage,
  findConversationBookingState,
  findOrCreateWhatsAppConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents,
  setConversationControlMode
} from "@/server/conversation/conversation-repository";
import { alertTeam } from "@/server/conversation/team-alert";
import { isEmergencyMessage } from "@/core/conversation/emergency";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createGenericBookingRouterClient } from "@/server/llm/generic-booking-router-client";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import type { WhatsAppInboundTextMessage } from "@/server/whatsapp/webhook";

type GenericWhatsAppInboundResult = {
  handled: boolean;
  sent: boolean;
  reply: string | null;
};

// WhatsApp-side mirror of the web widget's generic-booking-flow branch
// (src/app/api/widget/messages/route.ts) - same shared runGenericBookingTurn core, same
// conversation-repository helpers, just a text-channel caller instead of a JSON responder.
export async function handleGenericWhatsAppInboundMessage(
  input: WhatsAppInboundTextMessage,
  tenant: GenericBookingTurnTenant
): Promise<GenericWhatsAppInboundResult> {
  const travellerPhone = normalizeLocalPhone(input.from);
  const conversation = await findOrCreateWhatsAppConversation({
    tenantId: tenant.id,
    whatsappPhone: travellerPhone
  });

  // A person from the operator's team has this chat: keep the message, stay quiet.
  if (conversation.controlMode !== "AI") {
    await createTravellerMessage({ tenantId: tenant.id, conversationId: conversation.id, content: input.body });
    console.log("generic_whatsapp.kai_quiet_person_has_chat", { conversationId: conversation.id });
    return { handled: true, sent: false, reply: null };
  }

  const [previousBookingState, priorTravellerMessages, priorConversationMessages] = await Promise.all([
    findConversationBookingState({ tenantId: tenant.id, conversationId: conversation.id }),
    listRecentTravellerMessageContents({ tenantId: tenant.id, conversationId: conversation.id }),
    listRecentConversationMessages({ tenantId: tenant.id, conversationId: conversation.id })
  ]);

  await createTravellerMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: input.body
  });

  const { assistantContent, bookingResult } = await runGenericBookingTurn({
    tenant,
    conversationId: conversation.id,
    content: input.body,
    previousBookingState,
    priorTravellerMessages,
    priorConversationMessages,
    llmClient: createAssistantLlmClient(process.env),
    routerClient: createGenericBookingRouterClient(process.env),
    channel: "whatsapp"
  });

  await createAssistantMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content: assistantContent
  });

  await sendWhatsAppText({
    to: input.from,
    role: "kai",
    body: assistantContent
  });

  // The handoff reply is out, so the chat goes to a person on the operator's team, who hears about it.
  if (bookingResult?.action === "HUMAN_HANDOFF") {
    await setConversationControlMode({ tenantId: tenant.id, conversationId: conversation.id, controlMode: "HUMAN" });
    await alertTeam({
      tenantId: tenant.id,
      conversationId: conversation.id,
      reason: "PERSON_REQUESTED",
      channel: "whatsapp",
      travellerPhone,
      latestMessage: input.body
    });
  }
  if (isEmergencyMessage(input.body)) {
    await alertTeam({
      tenantId: tenant.id,
      conversationId: conversation.id,
      reason: "EMERGENCY",
      channel: "whatsapp",
      travellerPhone,
      latestMessage: input.body
    });
  }

  return {
    handled: true,
    sent: true,
    reply: assistantContent
  };
}
