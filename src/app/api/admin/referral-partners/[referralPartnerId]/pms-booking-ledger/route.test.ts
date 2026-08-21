import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { listPmsBookingLedgerEntriesForReferralPartner } from "@/server/payments/bluepass-pms-stripe";

vi.mock("@/server/payments/bluepass-pms-stripe", () => ({
  listPmsBookingLedgerEntriesForReferralPartner: vi.fn()
}));

const listPmsBookingLedgerEntriesForReferralPartnerMock = vi.mocked(listPmsBookingLedgerEntriesForReferralPartner);

describe("GET /api/admin/referral-partners/[referralPartnerId]/pms-booking-ledger", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(new Request("http://localhost/api/admin/referral-partners/partner_1/pms-booking-ledger"), {
      params: Promise.resolve({ referralPartnerId: "partner_1" })
    });

    expect(response.status).toBe(401);
    expect(listPmsBookingLedgerEntriesForReferralPartnerMock).not.toHaveBeenCalled();
  });

  it("accepts the admin token via cookie instead of a bearer header", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForReferralPartnerMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("http://localhost/api/admin/referral-partners/partner_1/pms-booking-ledger", {
        headers: { cookie: "kai_admin_token=admin_secret" }
      }),
      { params: Promise.resolve({ referralPartnerId: "partner_1" }) }
    );

    expect(response.status).toBe(200);
  });

  it("defaults to FINALIZED entries and forwards the take parameter", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForReferralPartnerMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("http://localhost/api/admin/referral-partners/partner_1/pms-booking-ledger?take=25", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ referralPartnerId: "partner_1" }) }
    );

    expect(response.status).toBe(200);
    expect(listPmsBookingLedgerEntriesForReferralPartnerMock).toHaveBeenCalledWith({
      referralPartnerId: "partner_1",
      status: undefined,
      take: 25
    });
  });

  it("forwards an explicit status filter", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForReferralPartnerMock.mockResolvedValueOnce([]);

    await GET(
      new Request("http://localhost/api/admin/referral-partners/partner_1/pms-booking-ledger?status=PENDING", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ referralPartnerId: "partner_1" }) }
    );

    expect(listPmsBookingLedgerEntriesForReferralPartnerMock).toHaveBeenCalledWith({
      referralPartnerId: "partner_1",
      status: "PENDING",
      take: 100
    });
  });

  it("clamps an out-of-range take to the documented ceiling", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listPmsBookingLedgerEntriesForReferralPartnerMock.mockResolvedValueOnce([]);

    await GET(
      new Request("http://localhost/api/admin/referral-partners/partner_1/pms-booking-ledger?take=9999", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ referralPartnerId: "partner_1" }) }
    );

    expect(listPmsBookingLedgerEntriesForReferralPartnerMock).toHaveBeenCalledWith({
      referralPartnerId: "partner_1",
      status: undefined,
      take: 200
    });
  });
});
