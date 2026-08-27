import { NextRequest, NextResponse } from "next/server";
import { listManualInquiriesForTenantSlugAndProductExternalIds } from "@/server/conversation/conversation-repository";

export const runtime = "nodejs";

// Every Rezdy-Agent-synced operator's "book now" click on Discover lands here today, not on a real
// PMS booking: the canonical BluePass tenant runs bookingMode MANUAL_INQUIRY / pmsProvider NATIVE
// (confirmed directly against production 2026-08-25), so there is no ledger to expose for these
// operators yet - only ManualInquiry rows. This is deliberately the same shared tenant
// bluepass-redesign's payouts.ts already calls INDONESIA_TENANT_SLUG.
const CANONICAL_TENANT_SLUG = "bluepass";

/**
 * Service-to-service endpoint: bluepass-redesign's operator dashboard calls this to show a
 * Rezdy-Agent-synced operator (no Kai tenant of their own) their own inquiry history, filtered by
 * the Rezdy product ids their `OperatorListing` rows carry.
 *
 * Same shared-secret pattern as marketplace-products (REZDY_AGENT_SYNC_TOKEN header) - this is the
 * same caller, not a new trust boundary.
 */
export async function GET(request: NextRequest) {
  const expectedToken = process.env.REZDY_AGENT_SYNC_TOKEN;
  const providedToken = request.headers.get("x-kai-internal-token");

  if (!expectedToken || providedToken !== expectedToken) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "A valid internal sync token is required." } },
      { status: 401 }
    );
  }

  const rawIds = new URL(request.url).searchParams.get("productExternalIds") ?? "";
  const productExternalIds = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  try {
    const inquiries = await listManualInquiriesForTenantSlugAndProductExternalIds({
      tenantSlug: CANONICAL_TENANT_SLUG,
      productExternalIds
    });
    return NextResponse.json({ inquiries });
  } catch (error) {
    console.error("rezdy_agent_manual_inquiries.fetch_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      {
        error: {
          code: "MANUAL_INQUIRIES_FETCH_FAILED",
          message: error instanceof Error ? error.message : "Failed to fetch manual inquiries."
        }
      },
      { status: 502 }
    );
  }
}
