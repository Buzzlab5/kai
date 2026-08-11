import { NextResponse } from "next/server";
import { settlePmsBookingPaymentAttempt } from "@/server/payments/bluepass-pms-stripe";

export const runtime = "nodejs";

type SettleRouteProps = {
  params: Promise<{ tenantSlug: string; attemptId: string }>;
};

/**
 * Milestone 1 (payment-settlement plan) admin endpoint: settles one direct-PMS/Rezdy booking -
 * releases the operator's payout (automatically via Stripe Connect if the tenant has one linked in
 * bluepass-redesign, otherwise via an admin-supplied manual bank-transfer reference) and marks the
 * PmsBookingPaymentAttempt SETTLED. Same admin-token auth pattern as the existing marketplace-flow
 * mark-paid route (src/app/api/admin/[tenantSlug]/bluepass-ledger/[entryId]/mark-paid).
 */
export async function POST(request: Request, { params }: SettleRouteProps) {
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
  const stripeConnectAccountId =
    typeof body?.stripeConnectAccountId === "string" ? body.stripeConnectAccountId.trim() : undefined;
  const paidOutReference = typeof body?.paidOutReference === "string" ? body.paidOutReference.trim() : undefined;

  if (!reviewerEmail) {
    return NextResponse.json(
      { error: { code: "MISSING_FIELDS", message: "reviewerEmail is required to settle a booking." } },
      { status: 400 }
    );
  }

  try {
    const result = await settlePmsBookingPaymentAttempt({
      attemptId,
      reviewerEmail,
      stripeConnectAccountId,
      paidOutReference
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to settle this booking.";
    return NextResponse.json({ error: { code: "SETTLE_FAILED", message } }, { status: 400 });
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
