import { NextRequest, NextResponse } from "next/server";
import { RezdyAgentPmsAdapter } from "@/core/pms/rezdy-agent-pms-adapter";

export const runtime = "nodejs";

/**
 * Service-to-service endpoint: bluepass-redesign's Discover sync job calls this to pull every
 * Rezdy-connected operator's products through BluePass's own Agent API credential, since the two
 * apps run on separate Supabase projects (no shared DB - see bluepass-rezdy-agent-api-v3 handoff)
 * and can't just query each other's tables directly.
 *
 * Auth is a static shared-secret header (REZDY_AGENT_SYNC_TOKEN), matching the existing
 * KAI_ADMIN_TOKEN pattern in src/app/api/admin/[tenantSlug]/settings/route.ts - a header rather than
 * a cookie since the caller is a server, not a browser session.
 *
 * Not wired to any tenant/TenantConfig - constructs RezdyAgentPmsAdapter straight from env vars,
 * since this is BluePass's single Agent account covering every connected operator's inventory, not a
 * per-tenant credential (see the REZDY_AGENT provider comment in @/core/tenant/types for why the
 * Prisma-enum/tenant wiring for this provider was deliberately deferred).
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

  const adapter = new RezdyAgentPmsAdapter({
    baseUrl: process.env.REZDY_AGENT_BASE_URL,
    apiKey: process.env.REZDY_AGENT_API_KEY,
    productListPath: process.env.REZDY_AGENT_PRODUCT_LIST_PATH,
    timeoutMs: Number(process.env.REZDY_AGENT_TIMEOUT_MS) || undefined
  });

  try {
    const products = await adapter.listMarketplaceProducts();
    return NextResponse.json({ products });
  } catch (error) {
    console.error("rezdy_agent_marketplace_products.fetch_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      {
        error: {
          code: "REZDY_AGENT_FETCH_FAILED",
          message: error instanceof Error ? error.message : "Failed to fetch Rezdy Agent marketplace products."
        }
      },
      { status: 502 }
    );
  }
}
