import { NextResponse } from "next/server";
import { listPmsBookingLedgerEntriesForTenantSlug } from "@/server/payments/bluepass-pms-stripe";

export const runtime = "nodejs";

type PmsBookingLedgerRouteProps = {
  params: Promise<{ tenantSlug: string }>;
};

const knownStatuses = ["PENDING", "FINALIZED", "VOIDED"] as const;

/**
 * The AU/Rezdy counterpart to /api/admin/[tenantSlug]/bluepass-ledger - same auth, same query shape,
 * different table (PmsBookingLedgerEntry instead of BluePassLedgerEntry). See
 * listPmsBookingLedgerEntriesForTenantSlug (bluepass-pms-stripe.ts) for why this didn't exist until now.
 */
export async function GET(request: Request, { params }: PmsBookingLedgerRouteProps) {
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

  const { tenantSlug } = await params;
  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));
  const take = parseTake(url.searchParams.get("take"));
  const entries = await listPmsBookingLedgerEntriesForTenantSlug({ tenantSlug, status, take });

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
