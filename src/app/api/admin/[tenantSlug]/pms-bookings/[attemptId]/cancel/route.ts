import { NextResponse } from "next/server";
import { cancelPmsBookingPaymentAttempt } from "@/server/payments/bluepass-pms-stripe";
import type { CancelledBy } from "@/core/cancellation/types";

export const runtime = "nodejs";

type CancelRouteProps = {
  params: Promise<{ tenantSlug: string; attemptId: string }>;
};

const VALID_CANCELLED_BY: CancelledBy[] = ["CUSTOMER", "OPERATOR", "ADMIN"];

/**
 * Milestone 3 (payment-settlement plan) admin endpoint: cancels a CONFIRMED direct-PMS/Rezdy booking
 * with a real Stripe refund, per the auto-refund calculator. Same KAI_ADMIN_TOKEN bearer/cookie auth
 * pattern as the sibling settle route.
 */
export async function POST(request: Request, { params }: CancelRouteProps) {
  const expectedToken = process.env.KAI_ADMIN_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const cookieToken = readCookie(request.headers.get("cookie"), "kai_admin_token");

  if (!expectedToken || (bearerToken !== expectedToken && cookieToken !== expectedToken)) {
    return NextResponse.json(
      { error: { code: "ADMIN_TOKEN_REQUIRED", message: "Admin access is required." } },
      { status: 401 }
    );
  }

  const { attemptId } = await params;
  const body = await request.json().catch(() => null);
  const reviewerEmail = typeof body?.reviewerEmail === "string" ? body.reviewerEmail.trim() : "";
  const cancelledByRaw = typeof body?.cancelledBy === "string" ? body.cancelledBy.trim().toUpperCase() : "";
  const cancellationReason = typeof body?.cancellationReason === "string" ? body.cancellationReason.trim() : undefined;
  const refundTierPercentOverride =
    typeof body?.refundTierPercentOverride === "number" ? body.refundTierPercentOverride : undefined;

  if (!reviewerEmail) {
    return NextResponse.json(
      { error: { code: "MISSING_FIELDS", message: "reviewerEmail is required to cancel a booking." } },
      { status: 400 }
    );
  }
  if (!VALID_CANCELLED_BY.includes(cancelledByRaw as CancelledBy)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_CANCELLED_BY",
          message: `cancelledBy must be one of ${VALID_CANCELLED_BY.join(", ")}.`
        }
      },
      { status: 400 }
    );
  }

  try {
    const result = await cancelPmsBookingPaymentAttempt({
      attemptId,
      cancelledBy: cancelledByRaw as CancelledBy,
      reviewerEmail,
      cancellationReason,
      refundTierPercentOverride
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel this booking.";
    return NextResponse.json({ error: { code: "CANCEL_FAILED", message } }, { status: 400 });
  }
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}
