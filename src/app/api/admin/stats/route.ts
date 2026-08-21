import { NextResponse } from "next/server";
import { getPlatformStats } from "@/server/admin/platform-stats";

export const runtime = "nodejs";

/**
 * Same KAI_ADMIN_TOKEN bearer/cookie auth pattern as the other admin endpoints. See
 * getPlatformStats (platform-stats.ts) for what's actually being summed and why it's FINALIZED-only.
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

  const stats = await getPlatformStats();

  return NextResponse.json(stats);
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
