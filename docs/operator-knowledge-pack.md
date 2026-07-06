# Operator Knowledge Pack — per-operator answers, built by Kai

Every operator has different policies and ops flows. The Knowledge Pack is **Layer 3** of the Kai
tenant model, and it's what lets Kai answer each operator's guests correctly instead of generically:

- **Business pack** (`src/core/business-pack`) = the category's ops flow (instant-book vs
  operator-acceptance, which tools Kai gets).
- **Tenant config** (`TenantConfig`) = one operator's wiring (PMS adapter, brand voice, guardrails).
- **Knowledge pack** (this) = one operator's **answers** — cancellation policy, minimum age,
  meeting point, what's included, best season, FAQs.

## How a guest question is answered

1. `matchKnowledgeEntry(message, pack)` (`src/core/knowledge/knowledge-matcher.ts`) deterministically
   scores the guest message against each entry (keyword hits + question-token overlap; ties break
   toward policy entries).
2. On a match, the entry's answer becomes the deterministic reply. For **policy** entries it is also
   passed as a `requiredFact`, so any LLM rephrase that drops the operator's wording is rejected by
   the existing `isSafeRewrite` guard and the verbatim answer is served. Kai can never invent a
   policy the operator didn't give.
3. On **no** match to a policy-shaped question (`isPolicyShapedQuestion`), Kai escalates to a human
   using the operator's own handoff line, rather than improvising.

Wired into `booking-orchestrator.ts` at the `GENERAL_QUESTION` and `HUMAN_HANDOFF` branches. Pure
core, so the marketplace flow can reuse it later (see open questions).

## How the pack is built — Kai interviews the operator

`src/core/knowledge/interview-engine.ts` + `interview-script.ts`. Kai walks the operator through ~13
ordered questions (policies first, escalation line last). The interview is a **pure state machine**
with no session table: progress lives inside the pack (`interview.completedFieldIds`,
`lastQuestionId`), so an operator can leave and resume — the next message re-derives the next
question. Each answer is bound to the **pending** question id (not inferred from the answer text), so
answers are never mis-filed; empty input re-prompts, `skip` advances without an entry.

Run it: `npx tsx scripts/kai-chat.ts --knowledge` — Kai interviews an operator, then answers guest
questions from the pack it just built.

## Storage

Additive: one JSON column `TenantConfig.operatorKnowledgePack` (mirrors `publicProductCatalog`),
migration `20260706120000_add_operator_knowledge_pack`. Loads for free via the existing config
include; `parseKnowledgePack` coalesces null/malformed to `EMPTY_KNOWLEDGE_PACK`; writes go through
`updateTenantOperationalSettings`.

## Left as clean hooks for Inov to place

- **Live interview entrypoint**: the engine is built and tested, but *where* an operator launches it
  (post-claim admin redirect vs. an "onboard me" intent in a chat surface) and *which* auth it uses
  (KAI_ADMIN_TOKEN vs. claim session) is an auth/surface decision — deliberately not guessed.
- **Admin React editor**: the server-side persistence path is wired end-to-end; the settings-page
  Q/A editor UI is a follow-up. The interview is the primary collection mechanism regardless.
- **Marketplace reuse**: `matchKnowledgeEntry` is pure core; wiring it into
  `handleBluePassMarketplaceMessage`'s fallback is a small later change.

## Tests

`src/core/knowledge/knowledge-matcher.test.ts` (12), `interview-engine.test.ts` (9, incl. the
adversarial out-of-order/empty-input cases), `src/core/booking/booking-orchestrator-knowledge.test.ts`
(5, incl. the verbatim-policy guard through the real orchestrator). 26 total, all passing.
