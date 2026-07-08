// Seeds an operator knowledge pack onto the kai-demo tenant so the
// generic-flow Knowledge Pack answering can be tested live.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const pack = {
  version: 1,
  entries: [
    {
      id: "cancellation-policy",
      question: "What is your cancellation and refund policy?",
      answer: "Full refund up to 48 hours before departure; 50% refund within 48 hours; no refund for no-shows.",
      keywords: ["cancel", "cancellation", "refund", "reschedule", "money back"],
      category: "policies",
      isPolicy: true,
    },
    {
      id: "min-age-safety",
      question: "Are there minimum age or safety restrictions?",
      answer: "Minimum age is 8 for the reef trip; under-12s must have a parent aboard; all guests must be able to swim.",
      keywords: ["age", "minimum age", "year old", "years old", "kid", "child", "swim", "safety"],
      category: "policies",
      isPolicy: true,
    },
    {
      id: "meeting-point",
      question: "Where and what time do we meet?",
      answer: "We meet at the Labuan Bajo marina gate at 7am; look for the blue Kai Demo flag.",
      keywords: ["where", "meet", "meeting point", "what time", "start time"],
      category: "logistics",
      isPolicy: false,
    },
    {
      id: "inclusions",
      question: "What's included in the price?",
      answer: "The price includes lunch, water, snorkel gear and an English-speaking guide.",
      keywords: ["included", "include", "inclusions", "meals", "lunch", "gear", "guide"],
      category: "itinerary",
      isPolicy: false,
    },
  ],
  escalation: {
    fallbackToHuman: true,
    handoffMessage: "Good question — let me pass you to our team so you get an accurate answer.",
    handoffKeywords: ["complaint", "injury"],
  },
  interview: {
    completedFieldIds: ["cancellation-policy", "min-age-safety", "meeting-point", "inclusions"],
    lastQuestionId: null,
    status: "complete",
  },
};

const tenant = await prisma.tenant.findUnique({ where: { slug: "kai-demo" }, include: { config: true } });
if (!tenant?.config) throw new Error("kai-demo tenant/config not found — run db:seed first");

await prisma.tenantConfig.update({
  where: { id: tenant.config.id },
  data: { operatorKnowledgePack: pack },
});
console.log(`Seeded knowledge pack onto kai-demo (${pack.entries.length} entries).`);
await prisma.$disconnect();
