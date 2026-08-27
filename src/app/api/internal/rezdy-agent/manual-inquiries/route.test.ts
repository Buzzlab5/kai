import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { listManualInquiriesForTenantSlugAndProductExternalIds } from "@/server/conversation/conversation-repository";

vi.mock("@/server/conversation/conversation-repository", () => ({
  listManualInquiriesForTenantSlugAndProductExternalIds: vi.fn()
}));

const listMock = vi.mocked(listManualInquiriesForTenantSlugAndProductExternalIds);

function request(query: string, token?: string) {
  return new Request(`http://localhost/api/internal/rezdy-agent/manual-inquiries${query}`, {
    headers: token ? { "x-kai-internal-token": token } : {}
  }) as never;
}

describe("GET /api/internal/rezdy-agent/manual-inquiries", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.REZDY_AGENT_SYNC_TOKEN;
  });

  it("requires a valid internal sync token", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";

    const response = await GET(request("?productExternalIds=AGT-1", "wrong_token"));

    expect(response.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("rejects every request when no sync token is configured, even with no header", async () => {
    const response = await GET(request("?productExternalIds=AGT-1"));

    expect(response.status).toBe(401);
  });

  it("parses the comma-separated product ids and queries the canonical bluepass tenant", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";
    listMock.mockResolvedValue([]);

    await GET(request("?productExternalIds=AGT-1, AGT-2 ,,AGT-3", "sync_secret"));

    expect(listMock).toHaveBeenCalledWith({
      tenantSlug: "bluepass",
      productExternalIds: ["AGT-1", "AGT-2", "AGT-3"]
    });
  });

  it("returns an empty id list rather than throwing when the query param is missing", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";
    listMock.mockResolvedValue([]);

    const response = await GET(request("", "sync_secret"));

    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith({ tenantSlug: "bluepass", productExternalIds: [] });
  });

  it("returns the mapped inquiries when the token is valid", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";
    listMock.mockResolvedValue([
      {
        id: "inq_1",
        status: "OPEN",
        productExternalId: "AGT-1",
        productTitle: "Reef Trip",
        dateText: "Saturday",
        guests: 2,
        travellerName: "Alex",
        travellerEmail: "alex@example.test",
        travellerPhone: null,
        travellerMessage: "I'd like to book this.",
        createdAt: new Date("2026-08-25T00:00:00Z")
      }
    ] as never);

    const response = await GET(request("?productExternalIds=AGT-1", "sync_secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inquiries).toHaveLength(1);
    expect(body.inquiries[0].productExternalId).toBe("AGT-1");
  });

  it("returns 502 with the error detail when the lookup fails", async () => {
    process.env.REZDY_AGENT_SYNC_TOKEN = "sync_secret";
    listMock.mockRejectedValue(new Error("DB unreachable"));

    const response = await GET(request("?productExternalIds=AGT-1", "sync_secret"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("MANUAL_INQUIRIES_FETCH_FAILED");
    expect(body.error.message).toBe("DB unreachable");
  });
});
