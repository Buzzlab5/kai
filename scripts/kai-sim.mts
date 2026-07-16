// Kai brain simulator - runs the deterministic Australia-first decision tree
// (country/region gate -> persona -> reply) against scripted conversations.
// Run:  npx tsx scripts/kai-sim.mts
import { resolveBluePassGate } from "../src/core/bluepass/market";
import {
  classifyBluePassPersona,
  buildBluePassOperatorReply,
  buildBluePassPartnerReply,
  buildBluePassLeadCapturedReply,
  buildBluePassTriageGreeting
} from "../src/core/bluepass/triage";
import { extractBluePassInquiryIntent, getMissingBluePassInquiryFields } from "../src/core/bluepass/intent";
import { buildBluePassMissingFieldsReply, buildBluePassSeasonReply, buildBluePassValueReply } from "../src/core/bluepass/reply";

const SEASON_Q = /(best time|when should|what month|which month|season|weather|stinger)/i;

function kaiRespond(history: string[], state: { pitched: boolean }): { reply: string; tag: string } {
  const gate = resolveBluePassGate(history);
  if (gate.step !== "READY") {
    return { reply: gate.prompt ?? "", tag: `GATE:${gate.step}` };
  }
  const persona = classifyBluePassPersona(history);
  const latest = history[history.length - 1];
  const market = gate.market ?? undefined;

  if (persona === "OPERATOR") {
    const r = buildBluePassOperatorReply({ latestMessage: latest, pitched: state.pitched, market });
    state.pitched = true;
    return { reply: r.reply + (r.showCatalog ? "  [+catalog cards]" : ""), tag: `OPERATOR (${market}/${gate.region})` };
  }
  if (persona === "PARTNER") {
    const r = buildBluePassPartnerReply({ latestMessage: latest, pitched: state.pitched, market });
    state.pitched = true;
    return { reply: r.reply + (r.showCatalog ? `  [+catalog: ${r.catalogDestination}]` : ""), tag: `PARTNER (${market}/${gate.region})` };
  }
  if (persona === "TRAVELLER") {
    const intent = extractBluePassInquiryIntent(history);
    const missing = getMissingBluePassInquiryFields(intent);
    const captured = Object.entries(intent).filter(([, v]) => v != null && v !== "" && (!Array.isArray(v) || v.length)).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`).join(", ");
    let reply: string;
    if (SEASON_Q.test(latest) && intent.destination) reply = buildBluePassSeasonReply(intent.destination);
    else if (missing.length) reply = buildBluePassMissingFieldsReply({ destination: intent.destination, missingFields: missing } as any);
    else reply = buildBluePassValueReply();
    return { reply: `${reply}${captured ? `\n         (captured: ${captured})` : ""}`, tag: `TRAVELLER (${market}/${gate.region})` };
  }
  return { reply: buildBluePassTriageGreeting(), tag: "UNKNOWN" };
}

function runConversation(title: string, turns: string[]) {
  console.log(`\n\x1b[1m\x1b[36m### ${title}\x1b[0m`);
  const history: string[] = [];
  const state = { pitched: false };
  for (const turn of turns) {
    history.push(turn);
    const { reply, tag } = kaiRespond(history, state);
    console.log(`\x1b[33m  You:\x1b[0m ${turn}`);
    console.log(`\x1b[32m  Kai:\x1b[0m ${reply}   \x1b[2m<${tag}>\x1b[0m`);
  }
}

console.log("\x1b[1m========== KAI BRAIN SIMULATOR (Australia-first) ==========\x1b[0m");

runConversation("1. AU traveller - full country->region->booking gate", [
  "hi",
  "I'm in Australia",
  "the Great Barrier Reef please",
  "when's the best time to go?",
  "diving for 6 people in June, I'm Sam, sam@example.com, wa +61 400 111 222"
]);

runConversation("2. AU operator (charter, wants to list)", [
  "I run charters out of Airlie Beach and want to get listed",
  "what's your cut?"
]);

runConversation("3. AU partner (travel agent, destination brief)", [
  "I'm a travel agent and my clients want the Great Barrier Reef"
]);

runConversation("4. Persona-collision guard ('we run' inside a traveller sentence)", [
  "Can we run through a few dates for our honeymoon on the reef?"
]);

runConversation("5. Indonesia still works, demoted behind the gate", [
  "we want a Komodo liveaboard for 8 in September"
]);

console.log("\n\x1b[1m\x1b[36m### 6. Australia-first content samples\x1b[0m");
console.log("\x1b[32m  Season(Great Barrier Reef):\x1b[0m " + buildBluePassSeasonReply("Great Barrier Reef"));
console.log("\x1b[32m  Season(Ningaloo Reef):     \x1b[0m " + buildBluePassSeasonReply("Ningaloo Reef"));
console.log("\x1b[32m  Operator lead captured (AU):\x1b[0m " + buildBluePassLeadCapturedReply({
  persona: "OPERATOR",
  lead: { company: "Whitsunday Reef Dive Charters", region: "Great Barrier Reef", email: "book@wrdc.com.au", phone: "+61 400 123 456" } as any
}));
console.log("");
