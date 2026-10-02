"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { setConversationControlModeForTenantSlug } from "@/server/conversation/conversation-repository";

/**
 * Take a chat over (Kai stays quiet while a person replies from the WhatsApp Business app) or hand
 * it back to Kai. Checks the admin token itself, since a server action can be called directly.
 */
export async function setConversationControlModeAction(formData: FormData) {
  const cookieStore = await cookies();
  const expectedToken = process.env.KAI_ADMIN_TOKEN;
  if (!expectedToken || cookieStore.get("kai_admin_token")?.value !== expectedToken) {
    throw new Error("Admin access required.");
  }

  const tenantSlug = String(formData.get("tenantSlug") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const controlMode = String(formData.get("controlMode") ?? "");
  if (!tenantSlug || !conversationId || (controlMode !== "AI" && controlMode !== "HUMAN")) {
    throw new Error("Invalid conversation control update.");
  }

  await setConversationControlModeForTenantSlug({ tenantSlug, conversationId, controlMode });
  revalidatePath(`/admin/${tenantSlug}/conversations/${conversationId}`);
}
