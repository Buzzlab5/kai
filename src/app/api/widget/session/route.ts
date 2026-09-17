import { NextRequest, NextResponse } from "next/server";
import {
  createWidgetConversation,
  findRecentWidgetConversationForTraveller,
  listRecentConversationMessages
} from "@/server/conversation/conversation-repository";
import { findAwaitingPaymentAttemptForTraveller } from "@/server/travellers/traveller-bookings";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { key?: string; travellerId?: string; resumeOnly?: boolean; forceNew?: boolean }
    | null;
  const widgetKey = body?.key;
  const travellerId = body?.travellerId?.trim() || undefined;
  const resumeOnly = body?.resumeOnly === true;
  // "Start a new conversation" for a signed-in traveller needs this: without it, the
  // existingConversation lookup below always wins and silently reattaches their last conversation,
  // which is normally the whole point of passing travellerId (see the comment on that lookup) but
  // is exactly the opposite of what a caller means by forceNew.
  const forceNew = body?.forceNew === true;

  if (!widgetKey) {
    return NextResponse.json(
      {
        error: {
          code: "WIDGET_KEY_REQUIRED",
          message: "Missing widget key."
        }
      },
      { status: 400 }
    );
  }

  const resolved = await resolveWidgetRequest({
    widgetKey,
    origin: getWidgetRequestOrigin(request)
  });

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const existingConversation = travellerId && !forceNew
    ? await findRecentWidgetConversationForTraveller({
        tenantId: resolved.tenant.id,
        travellerId
      })
    : null;

  // resumeOnly lets a caller check "does this traveller already have a conversation with this
  // specific tenant" (used to probe multiple tenants on mount, before any tenant is chosen) without
  // the side effect of creating an empty conversation in every tenant it merely checked.
  if (!existingConversation && resumeOnly) {
    return NextResponse.json({ resumed: false });
  }

  const conversation =
    existingConversation ??
    (await createWidgetConversation({
      tenantId: resolved.tenant.id,
      travellerId
    }));

  const messages = existingConversation
    ? await listRecentConversationMessages({
        tenantId: resolved.tenant.id,
        conversationId: existingConversation.id
      })
    : [];

  // Only worth checking on the one path that can actually strand an order: forceNew is what walks
  // away from whatever conversation the traveller was last in, so this is the one moment to warn
  // them there was a real, unpaid checkout sitting there before we let it go quiet.
  const unfinishedOrder =
    forceNew && travellerId ? await findAwaitingPaymentAttemptForTraveller(travellerId) : null;

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      tenantSlug: resolved.tenant.slug,
      channel: conversation.channel,
      controlMode: conversation.controlMode,
      updatedAt: conversation.updatedAt
    },
    resumed: Boolean(existingConversation),
    ...(messages.length > 0 ? { messages } : {}),
    ...(unfinishedOrder ? { unfinishedOrder } : {})
  });
}
