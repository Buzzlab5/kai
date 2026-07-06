/**
 * Terminal chat harness for the BluePass marketplace flow — talk to Kai
 * without a database or the widget. Persona triage, operator/partner
 * onboarding trees, and all concierge replies work fully; only inquiry
 * submission needs the real database (the harness warns instead of
 * crashing).
 *
 *   npx tsx scripts/kai-chat.ts             interactive chat
 *   npx tsx scripts/kai-chat.ts --demo      scripted three-persona walkthrough
 *   npx tsx scripts/kai-chat.ts --knowledge Kai interviews an operator, then
 *                                           answers guests from the built pack
 */

// Dummy datasource values so the Prisma client constructor is satisfied —
// the paths this harness exercises never run a query.
process.env.DATABASE_URL ??= "postgresql://kai:kai@localhost:5432/kai";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

import { createInterface } from "node:readline/promises";
import { handleBluePassMarketplaceMessage } from "../src/server/bluepass/bluepass-message-flow";
import { handleTravellerBookingMessage } from "../src/core/booking/booking-orchestrator";
import { MockPmsAdapter } from "../src/core/pms/mock-pms-adapter";
import { advanceInterview } from "../src/core/knowledge/interview-engine";
import { EMPTY_KNOWLEDGE_PACK, type OperatorKnowledgePack } from "../src/core/knowledge/types";

const tenantId = "tenant_local_harness";
const conversationId = `conversation_${Date.now()}`;
const priorTravellerMessages: string[] = [];

async function send(content: string) {
  try {
    const result = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content,
      priorTravellerMessages: [...priorTravellerMessages]
    });
    priorTravellerMessages.push(content);

    console.log(`\nKai: ${result.assistantContent}`);
    for (const match of result.bluepassMatches) {
      console.log(`  [card] ${match.name} — ${match.tier}, ${match.region}, ${match.priceSignal}`);
    }
    console.log("");
  } catch (error) {
    priorTravellerMessages.push(content);
    console.log(
      `\nKai: (this step needs the database — inquiry creation is not available in the harness)\n  ${
        error instanceof Error ? error.message.split("\n")[0] : error
      }\n`
    );
  }
}

const DEMO: Array<{ label: string; messages: string[] }> = [
  {
    label: "Ambiguous first touch",
    messages: ["hello"]
  },
  {
    label: "Operator — silent inference, then down the tree",
    messages: [
      "Hi, I run a dive resort in Raja Ampat and want to list my boats",
      "How does the 18% break down?",
      "How does vetting work?",
      "We're in Indonesia — send me the claim link",
      "We're Coral Cove Divers, based in Sorong. Email is ops@coralcove.com"
    ]
  },
  {
    label: "Partner — agency, then a client brief",
    messages: [
      "I'm a travel agent and I send divers to Indonesia",
      "How do commissions work?",
      "What's in the catalogue?",
      "Komodo for my clients"
    ]
  },
  {
    label: "Traveller — untouched booking flow",
    messages: ["My partner and I want to dive Komodo next month"]
  }
];

async function main() {
  if (process.argv.includes("--knowledge")) {
    await knowledgeDemo();
    return;
  }

  if (process.argv.includes("--demo")) {
    for (const scene of DEMO) {
      priorTravellerMessages.length = 0;
      console.log(`\n══ ${scene.label} ══`);
      for (const message of scene.messages) {
        console.log(`\nYou: ${message}`);
        await send(message);
      }
    }
    return;
  }

  console.log("Kai triage harness — type a message, or 'quit'. Fresh persona per run.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  for (;;) {
    const line = (await rl.question("You: ")).trim();
    if (!line || /^(quit|exit)$/i.test(line)) break;
    await send(line);
  }

  rl.close();
}

// The operator's answers to Kai's onboarding interview, in question order.
const OPERATOR_INTERVIEW_ANSWERS = [
  "Full refund up to 48 hours before departure, 50% inside 48 hours.",
  "If we cancel for weather you get a full refund or a free reschedule.",
  "We take a 20% deposit to hold the date; the balance is due 7 days before.",
  "Minimum age is 8 for the reef trip; under 12s must have a parent aboard.",
  "We meet at the Labuan Bajo marina gate at 7am sharp.",
  "Bring swimwear, a towel, reef-safe sunscreen and a light jacket.",
  "Yes, free hotel transfers within Labuan Bajo town.",
  "Our boat is a 25m phinisi: 12 guests max, 6 cabins, two bathrooms.",
  "Price includes lunch, water, snorkel gear and an English-speaking guide.",
  "Full day, about 8 hours, out to Padar, Pink Beach and Manta Point.",
  "Best months are April to October; we don't operate in January or February.",
  "Guests always rave about drifting with the mantas at Manta Point.",
  "Ask our team on WhatsApp — we reply within the hour.",
];

const GUEST_QUESTIONS = [
  "what's your cancellation policy?",
  "can my 8 year old come along?",
  "where do we meet and what time?",
  "what's included in the price?",
  "is there wheelchair access on board?", // policy-shaped, not in the pack → escalates
];

async function knowledgeDemo() {
  console.log("\n══ Kai interviews the operator to build their knowledge pack ══\n");
  let pack: OperatorKnowledgePack = structuredClone(EMPTY_KNOWLEDGE_PACK);

  console.log("Operator: onboard me");
  let advance = advanceInterview(pack, "onboard me");
  pack = advance.pack;
  if (advance.ask) console.log(`Kai: ${advance.ask.prompt}`);

  for (const answer of OPERATOR_INTERVIEW_ANSWERS) {
    console.log(`Operator: ${answer}`);
    advance = advanceInterview(pack, answer);
    pack = advance.pack;
    if (advance.ask) console.log(`Kai: ${advance.ask.prompt}`);
  }

  console.log(
    `\nPack built → ${pack.entries.length} answers, interview ${pack.interview.status}, ` +
      `handoff line: "${pack.escalation.handoffMessage}"`,
  );

  console.log("\n══ Guests ask; Kai answers from THIS operator's pack ══");
  const adapter = new MockPmsAdapter();
  for (const question of GUEST_QUESTIONS) {
    const result = await handleTravellerBookingMessage({
      message: question,
      pmsAdapter: adapter,
      knowledgePack: pack,
    });
    console.log(`\nGuest: ${question}`);
    console.log(`Kai [${result.action}]: ${result.reply}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
