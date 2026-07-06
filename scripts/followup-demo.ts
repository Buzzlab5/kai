/**
 * Follow-up engine demo — no DB, no clock of its own. Feeds synthetic
 * candidates through the pure evaluator and prints, for each, whether Kai
 * would nudge (and how) or why it holds back.
 *
 *   npx tsx scripts/followup-demo.ts
 */

import { evaluateFollowUp } from "../src/core/followup/rules";
import { DEFAULT_FOLLOWUP_CONFIG, type FollowUpCandidate } from "../src/core/followup/types";

const NOW = new Date("2026-03-10T06:00:00Z"); // 14:00 Asia/Makassar — daytime

function base(overrides: Partial<FollowUpCandidate>): FollowUpCandidate {
  return {
    id: "inq",
    tenantId: "t_1",
    stage: "QUOTE_SENT",
    stageEnteredAt: new Date("2026-03-09T05:00:00Z"),
    lastTravellerActivityAt: new Date("2026-03-09T04:00:00Z"),
    lastOperatorActivityAt: null,
    lastInboundAt: new Date("2026-03-09T05:00:00Z"),
    lastFollowUpAt: null,
    followUpCount: 0,
    channel: "whatsapp",
    contact: { name: "Ana Rivers", hasPhone: true, hasEmail: true },
    tripSummary: "Aliikai, Raja Ampat",
    destination: "Raja Ampat",
    operatorName: "Aliikai",
    dateWindow: "10 Nov",
    guests: 2,
    quoteUrl: "https://bluepass.co/quotes/inq",
    isTerminal: false,
    timezone: "Asia/Makassar",
    ...overrides,
  };
}

const SCENARIOS: Array<{ label: string; candidate: FollowUpCandidate; now?: Date }> = [
  { label: "Quote sent 25h ago, traveller silent", candidate: base({ id: "q1" }) },
  {
    label: "Operator hasn't replied in 13h",
    candidate: base({ id: "o1", stage: "OPERATOR_PENDING", stageEnteredAt: new Date("2026-03-09T17:00:00Z"), lastInboundAt: null }),
  },
  {
    label: "Operator declined 4h ago, no alternative taken",
    candidate: base({ id: "d1", stage: "DECLINED", stageEnteredAt: new Date("2026-03-10T02:00:00Z") }),
  },
  {
    label: "Operator lead captured 4 days ago, unclaimed",
    candidate: base({ id: "l1", stage: "LEAD_OPEN", stageEnteredAt: new Date("2026-03-06T05:00:00Z"), lastTravellerActivityAt: null, channel: "email", operatorName: null }),
  },
  {
    label: "Trip half-planned, went quiet 8h ago",
    candidate: base({ id: "a1", stage: "INQUIRY_DRAFT", stageEnteredAt: new Date("2026-03-09T22:00:00Z"), quoteUrl: null }),
  },
  { label: "SUPPRESSED — traveller already replied", candidate: base({ id: "s1", lastTravellerActivityAt: new Date("2026-03-09T12:00:00Z") }) },
  { label: "SUPPRESSED — already nudged twice", candidate: base({ id: "s2", followUpCount: 2 }) },
  { label: "SUPPRESSED — quiet hours (23:00 local)", candidate: base({ id: "s3", stageEnteredAt: new Date("2026-03-09T14:00:00Z") }), now: new Date("2026-03-10T15:00:00Z") },
];

for (const scenario of SCENARIOS) {
  const decision = evaluateFollowUp(scenario.candidate, scenario.now ?? NOW, DEFAULT_FOLLOWUP_CONFIG);
  console.log(`\n── ${scenario.label}`);
  if (decision.due) {
    const template = decision.plan.requiresTemplate ? ` [template: ${decision.plan.templateName}]` : " [free-form]";
    console.log(`   SEND (${decision.plan.channel}, ${decision.plan.audience})${template}`);
    console.log(`   "${decision.plan.message}"`);
  } else {
    console.log(`   hold — ${decision.reason}`);
  }
}
console.log("");
