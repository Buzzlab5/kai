import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { listPmsBookingLedgerEntriesForTenantSlug } from "@/server/payments/bluepass-pms-stripe";

vi.mock("@/server/payments/bluepass-pms-stripe", () => ({
  listPmsBookingLedgerEntriesForTenantSlug: vi.fn()
}));

const listPmsBookingLedgerEntriesForTenantSlugMock = vi.mocked(listPmsBookingLedgerEntriesForTenantSlug);

describe("GET /api/admin/[tenantSlug]/pms-booking-ledger", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(new Request("http://localhost/api/admin/boattime/pms-booking-ledger"), {
      params: Promise.resolve({ tenantSlug: "boattime" })
    });

    expect(response.status).toBe(401);
    expect(listPmsBookingLedgerEntriesForTenantSlugMock).not.toHaveBeenCalled();
  });

  it("accepts the admin token via cookie instead of a bearer header", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForTenantSlugMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("http://localhost/api/admin/boattime/pms-booking-ledger", {
        headers: { cookie: "kai_admin_token=admin_secret" }
      }),
      { params: Promise.resolve({ tenantSlug: "boattime" }) }
    );

    expect(response.status).toBe(200);
  });

  it("defaults to FINALIZED entries and forwards the take parameter", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForTenantSlugMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("http://localhost/api/admin/boattime/pms-booking-ledger?take=25", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ tenantSlug: "boattime" }) }
    );

    expect(response.status).toBe(200);
    expect(listPmsBookingLedgerEntriesForTenantSlugMock).toHaveBeenCalledWith({
      tenantSlug: "boattime",
      status: undefined,
      take: 25
    });
  });

  it("forwards an explicit status filter", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForTenantSlugMock.mockResolvedValueOnce([]);

    await GET(
      new Request("http://localhost/api/admin/boattime/pms-booking-ledger?status=PENDING", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ tenantSlug: "boattime" }) }
    );

    expect(listPmsBookingLedgerEntriesForTenantSlugMock).toHaveBeenCalledWith({
      tenantSlug: "boattime",
      status: "PENDING",
      take: 100
    });
  });

  it("clamps an out-of-range take to the documented ceiling", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForTenantSlugMock.mockResolvedValueOnce([]);

    await GET(
      new Request("http://localhost/api/admin/boattime/pms-booking-ledger?take=9999", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ tenantSlug: "boattime" }) }
    );

    expect(listPmsBookingLedgerEntriesForTenantSlugMock).toHaveBeenCalledWith({
      tenantSlug: "boattime",
      status: undefined,
      take: 200
    });
  });
});
