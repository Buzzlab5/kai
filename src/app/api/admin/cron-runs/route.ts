import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Milestone 3.5 (BOOKING_INTEGRATION_PLAN.md's "per-platform monitoring") - lets an admin check
 * whether the cron jobs (settle-pms-bookings today) are actually running and succeeding, instead of
 * only finding out something's broken when an operator complains about a missed payout. Same
 * KAI_ADMIN_TOKEN bearer/cookie auth pattern as the other admin endpoints.
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
  const jobName = url.searchParams.get("jobName")?.trim() || undefined;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;

  const runs = await prisma.cronRunLog.findMany({
    where: jobName ? { jobName } : undefined,
    orderBy: { finishedAt: "desc" },
    take: limit
  });

  return NextResponse.json({ runs });
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
