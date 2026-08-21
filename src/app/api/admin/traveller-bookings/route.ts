import { NextResponse } from "next/server";
import { getTravellerConservationTotal, listBookingsForTravellerAccount } from "@/server/travellers/traveller-bookings";

export const runtime = "nodejs";

/**
 * Service-to-service endpoint: bluepass-redesign calls this on behalf of its own signed-in traveller
 * to render their booking history. Same KAI_ADMIN_TOKEN bearer/cookie auth pattern as
 * /api/admin/cron-runs and /api/admin/[tenantSlug]/bluepass-ledger - not tenant-scoped, since a
 * traveller's bookings can span multiple tenants (the resolved BluePassAccount id is the whole query).
 */
export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const travellerAccountId = url.searchParams.get("travellerAccountId")?.trim();

  if (!travellerAccountId) {
    return NextResponse.json(
      { error: { code: "TRAVELLER_ACCOUNT_ID_REQUIRED", message: "travellerAccountId query parameter is required." } },
      { status: 400 }
    );
  }

  const [bookings, conservationByCurrency] = await Promise.all([
    listBookingsForTravellerAccount(travellerAccountId),
    getTravellerConservationTotal(travellerAccountId)
  ]);

  return NextResponse.json({ ...bookings, conservationByCurrency });
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
