import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getPlatformStats } from "@/server/admin/platform-stats";

vi.mock("@/server/admin/platform-stats", () => ({
  getPlatformStats: vi.fn()
}));

const getPlatformStatsMock = vi.mocked(getPlatformStats);

describe("GET /api/admin/stats", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(new Request("http://localhost/api/admin/stats"));

    expect(response.status).toBe(401);
    expect(getPlatformStatsMock).not.toHaveBeenCalled();
  });

  it("accepts the admin token via cookie instead of a bearer header", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    getPlatformStatsMock.mockResolvedValueOnce({
      au: { totalsByKindAndCurrency: [], bookingCount: 0 },
      indonesia: { totalsByKindAndCurrency: [], bookingCount: 0 }
    });

    const response = await GET(
      new Request("http://localhost/api/admin/stats", { headers: { cookie: "kai_admin_token=admin_secret" } })
    );

    expect(response.status).toBe(200);
  });

  it("returns the stats payload as-is", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    getPlatformStatsMock.mockResolvedValueOnce({
      au: { totalsByKindAndCurrency: [{ kind: "CONSERVATION_ALLOCATION", currency: "AUD", amountCents: 500 }], bookingCount: 1 },
      indonesia: { totalsByKindAndCurrency: [], bookingCount: 0 }
    });

    const response = await GET(
      new Request("http://localhost/api/admin/stats", { headers: { authorization: "Bearer admin_secret" } })
    );
    const body = await response.json();

    expect(body.au.bookingCount).toBe(1);
    expect(body.au.totalsByKindAndCurrency).toEqual([
      { kind: "CONSERVATION_ALLOCATION", currency: "AUD", amountCents: 500 }
    ]);
  });
});
