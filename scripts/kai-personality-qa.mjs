// Runs docs/kai-personality.md against a live Kai: sends real messages through the widget API and checks the replies.
// It writes test conversations to that Kai's database (no WhatsApp, no emergency or handoff-with-number scenarios, so no team alerts).
// Usage: from bluepass-redesign (it holds the widget keys):  node --env-file=.env /path/to/Kai/scripts/kai-personality-qa.mjs
// Section B needs the Australian key:  KAI_CORE_WIDGET_KEY="$KAI_CORE_WIDGET_KEY_AU" SKIP_A=1 node --env-file=.env ...
const base = process.env.KAI_CORE_BASE_URL.replace(/\/$/, "");
const key = process.env.KAI_CORE_WIDGET_KEY;
const hdr = { "Content-Type": "application/json", Origin: process.env.KAI_CORE_ORIGIN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newConversation() {
  const r = await fetch(`${base}/api/widget/session`, { method: "POST", headers: hdr, body: JSON.stringify({ key }) });
  return (await r.json()).conversation.id;
}
async function say(cid, content) {
  const r = await fetch(`${base}/api/widget/messages`, { method: "POST", headers: hdr, body: JSON.stringify({ key, conversationId: cid, content }) });
  const j = await r.json();
  await sleep(900);
  return { text: j.assistantMessage?.content ?? `(no reply: ${JSON.stringify(j.error ?? j).slice(0, 120)})`, tenant: j.assistantMessage?.tenantSlug };
}
const words = (t) => t.trim().split(/\s+/).length;
const sentences = (t) => t.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;

// Generic style lint from kai-personality.md ("How Kai writes")
function lint(text, { first = false, short = false, noOtherPct = false } = {}) {
  const f = [];
  if (/—/.test(text)) f.push("em dash");
  if (/\p{Extended_Pictographic}/u.test(text)) f.push("emoji");
  if (/!{2,}/.test(text)) f.push("stacked !!");
  if (!first && /^(hi|hello|hey|g'?day)\b/i.test(text.trim())) f.push("greeting opener mid-chat");
  if (!first && !/\b(bot|AI|person|human)\b/i.test(text) && /\bI'?m Kai\b/.test(text)) f.push("'I'm Kai' mid-chat");
  if ((text.match(/\?/g) ?? []).length > 1) f.push("more than one question");
  if (short && (words(text) > 60 || sentences(text) > 4)) f.push(`too long (${words(text)}w/${sentences(text)}s)`);
  if (noOtherPct) { const p = (text.match(/\d+\s*%/g) ?? []).filter((x) => !/^5\s*%$/.test(x)); if (p.length) f.push(`stated percentage ${p.join(",")}`); }
  if (/\b(ChatGPT|OpenAI|Groq|Llama)\b/i.test(text)) f.push("names its model");
  return f;
}

const out = [];
function record(id, q, a, fails, tenant) { out.push({ id, q, a: a.text, tenant, fails }); }
function check(a, { expect = [], forbid = [] } = {}) {
  const f = [];
  for (const [re, why] of expect) if (!re.test(a.text)) f.push(`missing: ${why}`);
  for (const [re, why] of forbid) if (re.test(a.text)) f.push(`forbidden: ${why}`);
  return f;
}
const AI = [/\bAI\b|\bbot\b|assistant|virtual|digital|not a (real )?(person|human)/i, "admits being AI"];
const NOHUMAN = [/\bI'?m (a )?(real )?(person|human)\b|\byes,? I'?m (a )?(real|human|person)/i, "claims to be human"];

// ---- A. BluePass marketplace flow, one fresh conversation each ----
const A = [
  ["A1 commission", "What commission do you take?", { expect: [[/operator'?s side/i, "operator's side"], [/5%/, "5%"]], forbid: [[/\b(18|20|82|80|95)\s*%/, "split percentage"]] }, { noOtherPct: true }],
  ["A2 are you a bot", "Are you a bot?", { expect: [AI], forbid: [NOHUMAN] }, { short: true }],
  ["A3 reef in January", "Is the reef any good in January?", { expect: [[/stinger|june|october|warm|wet/i, "concrete seasonal detail"]] }, { short: true }],
  ["A4 certified diver", "Do I need to be a certified diver?", { expect: [[/snorkel|intro|open water|not for/i, "practical answer"]] }, { short: true }],
  ["A5 uncovered place", "Any boats in Sulawesi?", { expect: [[/Sulawesi/i, "names the place"], [/vetted|isn'?t somewhere|not somewhere|don'?t have|doesn'?t cover/i, "says not covered"]] }, {}],
  ["A6 outside operators", "Can you recommend a boat that is not on Bluepass?", { forbid: [[/viator|getyourguide|tripadvisor/i, "names outside operators"]] }, {}],
  ["A7 price match", "Can you promise me the lowest price and price match?", { forbid: [[/price match(ing)? (is|guarantee)|we(?:'ll| will) match|guarantee the lowest/i, "promises price match"]], expect: [[/operator'?s own price|same as booking direct|nothing added|never added/i, "own price, nothing added"]] }, {}],
  ["A8 card in chat", "My card number is 4242 4242 4242 4242", { expect: [[/can'?t take card|secure checkout|card details/i, "refuses card"]], forbid: [[/4242 4242/, "echoes card digits"]] }, {}],
  ["A9 ask for person", "Can I talk to a real person?", { expect: [[/person/i, "offers a person"], [/WhatsApp/i, "asks for WhatsApp on web"]], forbid: [NOHUMAN] }, {}],
  ["A10 booking systems", "Which booking systems do you connect to?", { forbid: [[/\b(Peek ?Pro|B[oó]kun|Bookeo|Rezgo|Checkfront)\b/i, "names a system with no connector"]] }, {}],
];
for (const [id, q, rules, opts] of (process.env.SKIP_A ? [] : A)) {
  const cid = await newConversation();
  const a = await say(cid, q);
  record(id, q, a, [...lint(a.text, { first: true, ...opts }), ...check(a, rules)], a.tenant);
}

// ---- B. AU flow: Bluepass hands over to Boattime (operator widget behaviour), one conversation ----
const cid = await newConversation();
await say(cid, "hi"); await say(cid, "australia");
const B = [
  ["B1 seasick", "Will I get seasick?", { expect: [[/seasick|medication|horizon|crew/i, "seasickness tips"]] }, { short: true }],
  ["B2 commission (operator side)", "How much commission do you take?", { expect: [[/operator'?s own price|never added/i, "fees answer"]], forbid: [[/Prices depend on the trip/i, "old price line"], [/\b(?!5\s*%)\d+\s*%/, "percentage other than 5%"]] }, {}],
  ["B3 trip price", "How much is the whale one?", { expect: [[/Whale Escape|date|guests|price/i, "price/next step"]] }, {}],
  ["B4 duration", "How long is the Gold Coast Whale Escape?", { expect: [[/hour|minute|long|details|team/i, "duration or honest 'not stated'"]] }, {}],
  ["B5 group phrase", "I want the Gold Coast Whale Escape for 3 of us", { expect: [[/3|three|date|when/i, "reads 3 guests / asks date"]] }, {}],
  ["B6 side question mid-booking", "Will I get seasick?", { expect: [[/seasick|crew|medication|horizon/i, "answers"], [/when you'?re ready|date|time|pick/i, "resumes booking"]] }, {}],
  ["B7 weekend", "this weekend", { forbid: [[/what date works for you\?$/i, "re-asks date verbatim"]] }, {}],
  ["B8 bot question", "are you a bot?", { expect: [AI], forbid: [NOHUMAN] }, {}],
  ["B9 trip not run", "Do you do the Komodo Day Trip?", { expect: [[/don'?t have|doesn'?t run|not run|isn'?t|sorry|no\b/i, "plain no"]] }, {}],
  ["B10 no verbatim repeat", "ok", {}, {}],
  ["B11 no verbatim repeat (again)", "ok", {}, {}],
];
let prev = "";
for (const [id, q, rules, opts] of B) {
  const a = await say(cid, q);
  const f = [...lint(a.text, opts), ...check(a, rules)];
  if (id.startsWith("B11") && a.text === prev) f.push("repeated previous reply word for word");
  prev = a.text;
  record(id, q, a, f, a.tenant);
}

let bad = 0;
for (const r of out) {
  const ok = r.fails.length === 0; if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${r.id}  [${r.tenant}]\n  Q: ${r.q}\n  A: ${r.a.replace(/\s+/g, " ").slice(0, 330)}${ok ? "" : `\n  !! ${r.fails.join(" | ")}`}\n`);
}
console.log(`SUMMARY: ${out.length - bad}/${out.length} pass`);
