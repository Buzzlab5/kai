import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import {
  createWidgetConversation,
  findRecentWidgetConversationForTraveller,
  listRecentConversationMessages
} from "@/server/conversation/conversation-repository";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";

vi.mock("@/server/conversation/conversation-repository", () => ({
  createWidgetConversation: vi.fn(),
  findRecentWidgetConversationForTraveller: vi.fn(),
  listRecentConversationMessages: vi.fn()
}));
vi.mock("@/server/widget/resolve-widget-request", () => ({
  resolveWidgetRequest: vi.fn()
}));

const createWidgetConversationMock = vi.mocked(createWidgetConversation);
const findRecentWidgetConversationForTravellerMock = vi.mocked(findRecentWidgetConversationForTraveller);
const listRecentConversationMessagesMock = vi.mocked(listRecentConversationMessages);
const resolveWidgetRequestMock = vi.mocked(resolveWidgetRequest);

const TENANT = { id: "tenant_1", slug: "boattime" };
const EXISTING = { id: "convo_old", channel: "WEB_WIDGET", controlMode: "AUTOMATED", updatedAt: new Date() };
const FRESH = { id: "convo_new", channel: "WEB_WIDGET", controlMode: "AUTOMATED", updatedAt: new Date() };

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/widget/session", {
      method: "POST",
      body: JSON.stringify(body)
    }) as unknown as import("next/server").NextRequest
  );
}

describe("POST /api/widget/session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resumes a signed-in traveller's existing conversation by default", async () => {
    resolveWidgetRequestMock.mockResolvedValue({ ok: true, tenant: TENANT } as never);
    findRecentWidgetConversationForTravellerMock.mockResolvedValue(EXISTING as never);
    listRecentConversationMessagesMock.mockResolvedValue([]);

    const response = await post({ key: "pk_test", travellerId: "acct_1" });
    const data = await response.json();

    expect(findRecentWidgetConversationForTravellerMock).toHaveBeenCalledWith({
      tenantId: TENANT.id,
      travellerId: "acct_1"
    });
    expect(createWidgetConversationMock).not.toHaveBeenCalled();
    expect(data.conversation.id).toBe(EXISTING.id);
    expect(data.resumed).toBe(true);
  });

  // The bug this guards against: "Start a new conversation" in the widget cleared the client's own
  // sessionId, but the very next message still round-tripped through here with travellerId set (a
  // signed-in traveller), which resumed the exact conversation the traveller just asked to leave -
  // see forceNewSessionRef in bluepass-redesign's KaiPanel.tsx for the full chain this was found in.
  it("skips the existing-conversation lookup entirely when forceNew is set, even for a signed-in traveller", async () => {
    resolveWidgetRequestMock.mockResolvedValue({ ok: true, tenant: TENANT } as never);
    createWidgetConversationMock.mockResolvedValue(FRESH as never);

    const response = await post({ key: "pk_test", travellerId: "acct_1", forceNew: true });
    const data = await response.json();

    expect(findRecentWidgetConversationForTravellerMock).not.toHaveBeenCalled();
    expect(createWidgetConversationMock).toHaveBeenCalledWith({ tenantId: TENANT.id, travellerId: "acct_1" });
    expect(data.conversation.id).toBe(FRESH.id);
    expect(data.resumed).toBe(false);
    // No messages fetched for a conversation that was just created - nothing to fetch yet, and
    // listRecentConversationMessages is only ever called against an existingConversation.
    expect(listRecentConversationMessagesMock).not.toHaveBeenCalled();
  });

  it("still tags the freshly created conversation to the traveller's account, so later normal resumes work", async () => {
    resolveWidgetRequestMock.mockResolvedValue({ ok: true, tenant: TENANT } as never);
    createWidgetConversationMock.mockResolvedValue(FRESH as never);

    await post({ key: "pk_test", travellerId: "acct_1", forceNew: true });

    expect(createWidgetConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({ travellerId: "acct_1" })
    );
  });
});
