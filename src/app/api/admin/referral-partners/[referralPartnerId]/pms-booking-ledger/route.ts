import { NextResponse } from "next/server";
import { listPmsBookingLedgerEntriesForReferralPartner } from "@/server/payments/bluepass-pms-stripe";

export const runtime = "nodejs";

type ReferralPartnerLedgerRouteProps = {
  params: Promise<{ referralPartnerId: string }>;
};

const knownStatuses = ["PENDING", "FINALIZED", "VOIDED"] as const;

/**
 * The referral-partner counterpart to /api/admin/[tenantSlug]/pms-booking-ledger - same auth, same
 * query shape, scoped by referralPartnerId instead of tenantSlug. See
 * listPmsBookingLedgerEntriesForReferralPartner (bluepass-pms-stripe.ts) for why a partner's own
 * dashboard needs this rather than the tenant-scoped route.
 */
export async function GET(request: Request, { params }: ReferralPartnerLedgerRouteProps) {
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

  const { referralPartnerId } = await params;
  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));
  const take = parseTake(url.searchParams.get("take"));
  const entries = await listPmsBookingLedgerEntriesForReferralPartner({ referralPartnerId, status, take });

  return NextResponse.json({ entries });
}

function parseStatus(value: string | null) {
  return knownStatuses.find((status) => status === value);
}

function parseTake(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(Math.max(parsed, 1), 200);
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
