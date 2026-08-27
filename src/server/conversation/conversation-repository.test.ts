import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  captureConversationReferralAttribution,
  createManualInquiry,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listManualInquiriesForTenantSlugAndProductExternalIds,
  setWhatsAppConversationControlMode
} from "./conversation-repository";

async function createTestTenant(label: string) {
  return prisma.tenant.create({
    data: {
      slug: `conversation-repo-${label}-${randomUUID()}`,
      name: `Conversation Repo ${label} Test`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
}

// No test DB exists in this repo - these tests write real rows to the same Supabase instance
// production reads from.
afterAll(async () => {
  const testTenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: "conversation-repo-" } },
    select: { id: true }
  });
  const tenantIds = testTenants.map((tenant) => tenant.id);
  if (tenantIds.length === 0) return;
  await prisma.conversation.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
});

describe("findOrCreateWhatsAppConversation", () => {
  it("creates a new AI-mode WhatsApp conversation when none exists for the phone", async () => {
    const tenant = await createTestTenant("create");
    const whatsappPhone = "6281111100001";

    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });

    expect(conversation.tenantId).toBe(tenant.id);
    expect(conversation.channel).toBe("WHATSAPP");
    expect(conversation.controlMode).toBe("AI");
    expect(conversation.whatsappPhone).toBe(whatsappPhone);
  });

  it("reuses the existing conversation for the same tenant and phone instead of creating a second one", async () => {
    const tenant = await createTestTenant("reuse");
    const whatsappPhone = "6281111100002";

    const first = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });
    const second = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });

    expect(second.id).toBe(first.id);
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, whatsappPhone }
    });
    expect(conversations).toHaveLength(1);
  });

  it("keeps two tenants' conversations separate even when they share the same WhatsApp phone", async () => {
    const whatsappPhone = "6281111100003";
    const tenantA = await createTestTenant("tenant-a");
    const tenantB = await createTestTenant("tenant-b");

    const conversationA = await findOrCreateWhatsAppConversation({ tenantId: tenantA.id, whatsappPhone });
    const conversationB = await findOrCreateWhatsAppConversation({ tenantId: tenantB.id, whatsappPhone });

    expect(conversationA.id).not.toBe(conversationB.id);
    expect(conversationA.tenantId).toBe(tenantA.id);
    expect(conversationB.tenantId).toBe(tenantB.id);
  });
});

describe("setWhatsAppConversationControlMode", () => {
  it("flips control mode on an existing WhatsApp conversation", async () => {
    const tenant = await createTestTenant("control-existing");
    const whatsappPhone = "6281111100004";
    const existing = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone });
    expect(existing.controlMode).toBe("AI");

    const updated = await setWhatsAppConversationControlMode({
      tenantId: tenant.id,
      whatsappPhone,
      controlMode: "HUMAN"
    });

    expect(updated.id).toBe(existing.id);
    expect(updated.controlMode).toBe("HUMAN");
  });

  it("creates the conversation with the requested control mode when a human replies before Kai ever sees the thread", async () => {
    const tenant = await createTestTenant("control-new");
    const whatsappPhone = "6281111100005";

    const created = await setWhatsAppConversationControlMode({
      tenantId: tenant.id,
      whatsappPhone,
      controlMode: "PAUSED"
    });

    expect(created.tenantId).toBe(tenant.id);
    expect(created.whatsappPhone).toBe(whatsappPhone);
    expect(created.controlMode).toBe("PAUSED");

    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, whatsappPhone }
    });
    expect(conversations).toHaveLength(1);
  });
});

// kai-conversation-flow-notes.md finding #16 (compliance): a real card number pasted by a traveller
// must never survive verbatim in the transcript store, even though the payment itself was refused.
describe("createTravellerMessage", () => {
  it("redacts a card number/CVV before writing the message to the database", async () => {
    const tenant = await createTestTenant("redact");
    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: "6281111199999" });

    const message = await createTravellerMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      content: "Fine, book it. My card is 4111 1111 1111 1111, exp 04/29, cvv 123."
    });

    expect(message.content).not.toContain("4111");
    expect(message.content).not.toContain("123.");
    expect(message.content).toContain("[card number redacted]");
    expect(message.content).toContain("Fine, book it.");
  });

  it("leaves an ordinary message completely unchanged", async () => {
    const tenant = await createTestTenant("no-redact");
    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: "6281111188888" });

    const message = await createTravellerMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      content: "2 guests, Saturday 15 August"
    });

    expect(message.content).toBe("2 guests, Saturday 15 August");
  });
});

describe("captureConversationReferralAttribution", () => {
  it("fills in referral fields on first touch when the conversation has none yet", async () => {
    const tenant = await createTestTenant("ref-first-touch");
    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: "6281112220001" });

    await captureConversationReferralAttribution({
      conversation,
      referral: { referralPartnerId: "partner_1", referralLinkId: "link_1", referralCode: "abc123", referralRole: "CREATOR" }
    });

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.referralPartnerId).toBe("partner_1");
    expect(updated.referralLinkId).toBe("link_1");
    expect(updated.referralCode).toBe("abc123");
    expect(updated.referralRole).toBe("CREATOR");
  });

  it("never overwrites attribution already set on the conversation", async () => {
    const tenant = await createTestTenant("ref-no-overwrite");
    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: "6281112220002" });
    await captureConversationReferralAttribution({
      conversation,
      referral: { referralPartnerId: "partner_original", referralCode: "original-code" }
    });
    const afterFirstTouch = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });

    await captureConversationReferralAttribution({
      conversation: afterFirstTouch,
      referral: { referralPartnerId: "partner_different", referralCode: "different-code" }
    });

    const stillOriginal = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(stillOriginal.referralPartnerId).toBe("partner_original");
    expect(stillOriginal.referralCode).toBe("original-code");
  });

  it("is a no-op when no referral is present on the request", async () => {
    const tenant = await createTestTenant("ref-none");
    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: "6281112220003" });

    await captureConversationReferralAttribution({ conversation, referral: null });

    const unchanged = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(unchanged.referralPartnerId).toBeNull();
  });
});

describe("listManualInquiriesForTenantSlugAndProductExternalIds", () => {
  it("returns only the inquiries matching the given product ids on the given tenant", async () => {
    const tenant = await createTestTenant("mi-filter");
    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: "6281113330001" });

    await createManualInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      state: { productExternalId: "AGT-1", productTitle: "Reef Trip", dateText: "Saturday", guests: 2 },
      travellerMessage: "I'd like to book the reef trip.",
      travellerName: "Alex",
      travellerEmail: "alex@example.test"
    });
    await createManualInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      state: { productExternalId: "AGT-2", productTitle: "Sunset Sail", dateText: "Sunday", guests: 4 },
      travellerMessage: "Any spots for the sunset sail?"
    });

    const matched = await listManualInquiriesForTenantSlugAndProductExternalIds({
      tenantSlug: tenant.slug,
      productExternalIds: ["AGT-1"]
    });

    expect(matched).toHaveLength(1);
    expect(matched[0].productExternalId).toBe("AGT-1");
    expect(matched[0].travellerName).toBe("Alex");
  });

  it("never leaks another tenant's inquiries for the same product id", async () => {
    const tenantA = await createTestTenant("mi-tenant-a");
    const tenantB = await createTestTenant("mi-tenant-b");
    const conversationA = await findOrCreateWhatsAppConversation({ tenantId: tenantA.id, whatsappPhone: "6281113330002" });
    const conversationB = await findOrCreateWhatsAppConversation({ tenantId: tenantB.id, whatsappPhone: "6281113330003" });

    await createManualInquiry({
      tenantId: tenantA.id,
      conversationId: conversationA.id,
      state: { productExternalId: "SHARED-CODE", productTitle: "Tenant A Trip", dateText: null, guests: null },
      travellerMessage: "Tenant A inquiry"
    });
    await createManualInquiry({
      tenantId: tenantB.id,
      conversationId: conversationB.id,
      state: { productExternalId: "SHARED-CODE", productTitle: "Tenant B Trip", dateText: null, guests: null },
      travellerMessage: "Tenant B inquiry"
    });

    const matched = await listManualInquiriesForTenantSlugAndProductExternalIds({
      tenantSlug: tenantA.slug,
      productExternalIds: ["SHARED-CODE"]
    });

    expect(matched).toHaveLength(1);
    expect(matched[0].productTitle).toBe("Tenant A Trip");
  });

  it("returns no rows at all for an empty product id list, rather than every inquiry on the tenant", async () => {
    const tenant = await createTestTenant("mi-empty-ids");
    const conversation = await findOrCreateWhatsAppConversation({ tenantId: tenant.id, whatsappPhone: "6281113330004" });
    await createManualInquiry({
      tenantId: tenant.id,
      conversationId: conversation.id,
      state: { productExternalId: "AGT-3", productTitle: "Whale Watch", dateText: null, guests: null },
      travellerMessage: "Whale watch inquiry"
    });

    const matched = await listManualInquiriesForTenantSlugAndProductExternalIds({
      tenantSlug: tenant.slug,
      productExternalIds: []
    });

    expect(matched).toEqual([]);
  });
});
