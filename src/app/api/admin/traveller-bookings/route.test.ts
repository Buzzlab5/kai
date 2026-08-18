import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { listBookingsForTravellerAccount } from "@/server/travellers/traveller-bookings";

vi.mock("@/server/travellers/traveller-bookings", () => ({
  listBookingsForTravellerAccount: vi.fn()
}));

const listBookingsForTravellerAccountMock = vi.mocked(listBookingsForTravellerAccount);

describe("GET /api/admin/traveller-bookings", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(
      new Request("http://localhost/api/admin/traveller-bookings?travellerAccountId=acct_1")
    );

    expect(response.status).toBe(401);
    expect(listBookingsForTravellerAccountMock).not.toHaveBeenCalled();
  });

  it("accepts the admin token via cookie instead of a bearer header", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listBookingsForTravellerAccountMock.mockResolvedValueOnce({ auBookings: [], indonesiaInquiries: [] });

    const response = await GET(
      new Request("http://localhost/api/admin/traveller-bookings?travellerAccountId=acct_1", {
        headers: { cookie: "kai_admin_token=admin_secret" }
      })
    );

    expect(response.status).toBe(200);
  });

  it("requires travellerAccountId", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(
      new Request("http://localhost/api/admin/traveller-bookings", {
        headers: { authorization: "Bearer admin_secret" }
      })
    );

    expect(response.status).toBe(400);
    expect(listBookingsForTravellerAccountMock).not.toHaveBeenCalled();
  });

  it("returns the bookings for the requested account", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listBookingsForTravellerAccountMock.mockResolvedValueOnce({ auBookings: [], indonesiaInquiries: [] });

    const response = await GET(
      new Request("http://localhost/api/admin/traveller-bookings?travellerAccountId=acct_1", {
        headers: { authorization: "Bearer admin_secret" }
      })
    );

    expect(response.status).toBe(200);
    expect(listBookingsForTravellerAccountMock).toHaveBeenCalledWith("acct_1");
    expect(await response.json()).toEqual({ auBookings: [], indonesiaInquiries: [] });
  });
});
