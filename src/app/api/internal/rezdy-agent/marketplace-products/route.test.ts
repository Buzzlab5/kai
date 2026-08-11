import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { RezdyAgentPmsAdapter } from "@/core/pms/rezdy-agent-pms-adapter";

vi.mock("@/core/pms/rezdy-agent-pms-adapter", () => ({
  RezdyAgentPmsAdapter: vi.fn()
}));

const RezdyAgentPmsAdapterMock = vi.mocked(RezdyAgentPmsAdapter);

function request(token?: string) {
  return new Request("http://localhost/api/internal/rezdy-agent/marketplace-products", {
    headers: token ? { "x-kai-internal-token": token } : {}
  });
}

describe("GET /api/internal/rezdy-agent/marketplace-products", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.REZDY_AGENT_SYNC_TOKEN;
  });

  it("requires a valid internal sync token", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";

    const response = await GET(request("wrong_token") as never);

    expect(response.status).toBe(401);
    expect(RezdyAgentPmsAdapterMock).not.toHaveBeenCalled();
  });

  it("rejects every request when no sync token is configured, even with no header", async () => {
    const response = await GET(request() as never);

    expect(response.status).toBe(401);
  });

  it("returns mapped marketplace products when the token is valid", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";
    const listMarketplaceProducts = vi.fn().mockResolvedValue([
      { productCode: "AGT-1", name: "Reef Trip", supplierName: "Acme Charters" }
    ]);
    RezdyAgentPmsAdapterMock.mockImplementation(() => ({ listMarketplaceProducts } as never));

    const response = await GET(request("sync_secret") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ products: [{ productCode: "AGT-1", name: "Reef Trip", supplierName: "Acme Charters" }] });
  });

  it("returns 502 with the error detail when the Rezdy fetch fails", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";
    const listMarketplaceProducts = vi.fn().mockRejectedValue(new Error("REZDY_AGENT PMS API request failed with status 500."));
    RezdyAgentPmsAdapterMock.mockImplementation(() => ({ listMarketplaceProducts } as never));

    const response = await GET(request("sync_secret") as never);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("REZDY_AGENT_FETCH_FAILED");
    expect(body.error.message).toContain("status 500");
  });
});
