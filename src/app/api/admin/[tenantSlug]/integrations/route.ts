import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PmsProvider } from "@/core/tenant/types";
import { connectTenantPms, getTenantIntegrationStatuses } from "@/server/pms/connect-tenant-pms";

export const runtime = "nodejs";

type IntegrationsRouteProps = {
  params: Promise<{ tenantSlug: string }>;
};

function isAuthorized(request: NextRequest, bodyToken?: string) {
  const expected = process.env.KAI_ADMIN_TOKEN;
  if (!expected) return false;
  const cookieToken = request.cookies.get("kai_admin_token")?.value;
  const headerToken = request.headers.get("x-kai-admin-token") ?? undefined;
  return cookieToken === expected || headerToken === expected || bodyToken === expected;
}

const unauthorized = () =>
  NextResponse.json({ error: { code: "ADMIN_TOKEN_REQUIRED", message: "Admin access is required." } }, { status: 401 });

export async function GET(request: NextRequest, { params }: IntegrationsRouteProps) {
  const { tenantSlug } = await params;
  if (!isAuthorized(request)) return unauthorized();

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    return NextResponse.json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found." } }, { status: 404 });
  }

  const integrations = await getTenantIntegrationStatuses(tenant.id);
  return NextResponse.json({ tenant: { slug: tenant.slug }, integrations });
}

export async function POST(request: NextRequest, { params }: IntegrationsRouteProps) {
  const { tenantSlug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    provider?: string;
    credentials?: Record<string, string>;
    adminToken?: string;
  };

  if (!isAuthorized(request, typeof body.adminToken === "string" ? body.adminToken : undefined)) {
    return unauthorized();
  }

  const provider = String(body.provider ?? "").toUpperCase() as PmsProvider;
  const credentials =
    body.credentials && typeof body.credentials === "object"
      ? Object.fromEntries(Object.entries(body.credentials).map(([k, v]) => [k, String(v ?? "").trim()]))
      : {};

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    return NextResponse.json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found." } }, { status: 404 });
  }

  const result = await connectTenantPms({ tenantId: tenant.id, provider, credentials });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: { code: result.code, message: result.error } }, { status: 400 });
  }

  return NextResponse.json(result);
}
