# Follow-up engine — proactive Kai

Kai only ever speaks when spoken to today. The follow-up engine makes it proactive: it decides, from
timestamps that already exist on inquiries / quotes / leads, **which records are due for a nudge,
what nudge, and on which channel — without ever over-messaging a customer.**

Pure core (`src/core/followup`): no Prisma, no I/O, no clock of its own (the caller passes `now`), so
every decision branch is unit-tested. The live layer (a scheduled job) is a thin shell over it, and
is deliberately left as documented hooks — it needs the DB, a WhatsApp sender, and a cron, which are
the repo owner's infra decisions.

Run the demo: `npx tsx scripts/followup-demo.ts`.

## Triggers (stage → nudge)

| Stage (candidate is in) | Nudge | Aimed at | Default: first after / max / gap |
|---|---|---|---|
| `QUOTE_SENT` — quote drafted `READY_FOR_TRAVELLER`, not approved | Quote awaiting you | traveller | 24h / 2 / 48h |
| `OPERATOR_PENDING` — dispatched, no operator reply | Guest is waiting | operator | 12h / 2 / 12h |
| `DECLINED` — operator declined, no alternative taken | I've got alternatives | traveller | 3h / 1 / 24h |
| `LEAD_OPEN` — operator/partner lead, unclaimed | Your page is ready to claim | lead | 72h / 2 / 72h |
| `INQUIRY_DRAFT` — partial intent, never submitted | Still keen? | traveller | 6h / 1 / 24h |

Stages are mutually exclusive by construction (a quote only exists after the operator accepts), so
one candidate yields at most one nudge. The quote nudge leads because it is the revenue-closest.

## Suppression — the engine holds back when

Checked in this order, each returning an observable reason (`FollowUpDecision`):
1. `terminal` — caller-computed converted/closed/booked. Never nudge.
2. `no_contact_channel` — WhatsApp/SMS with no phone, or email with no email.
3. `party_already_responded` — the party we'd message acted after the stage began (operator stage
   watches the operator clock; everything else watches the customer clock). The trigger is stale.
4. `not_due_yet` — before the stage's first-nudge threshold.
5. `cadence_exhausted` — hit the per-stage nudge cap.
6. `cooldown` — a nudge went out within the minimum gap.
7. `quiet_hours` — local time is inside the tenant's quiet window (default 21:00–08:00). Deferred to
   the next run outside quiet hours, never dropped.

## WhatsApp 24-hour window

Outside the 24h customer-service window (no inbound from the contact in `serviceWindowHours`), Meta
allows only approved templates. The plan carries `requiresTemplate` + `templateName`
(`bluepass_inquiry_update` for traveller/lead, `booking_inquiry_operator` for operator) so the sender
never sends free-form outside the window. Inside the window (or on web/email), free-form is used.

## Integration contract — what the live layer must provide

`FollowUpCandidate` (types.ts) is the storage-agnostic view the DB layer builds. The scheduled job:

1. **Query** open records into `FollowUpCandidate[]` — from `BluePassInquiry` + its
   `BluePassInquiryEvent`s: derive `stage` (quote events `BLUEPASS_QUOTE_DRAFTED` without
   `BLUEPASS_QUOTE_APPROVED` → `QUOTE_SENT`; status `OPERATOR_PENDING` → that stage; etc.),
   `stageEnteredAt` (the event time), `lastTravellerActivityAt` / `lastOperatorActivityAt` (last
   `Message` by role), `lastInboundAt` (for the window), and follow-up history.
2. **Evaluate**: `evaluateFollowUps(candidates, new Date(), DEFAULT_FOLLOWUP_CONFIG)`.
3. **Send** each plan (free-form or template per `requiresTemplate`), reusing the existing WhatsApp
   client + `whatsappTemplateNames`.
4. **Record** each send (a `BluePassInquiryEvent` type e.g. `KAI_FOLLOWUP_SENT` with `dedupeKey`) so
   `followUpCount` / `lastFollowUpAt` advance and cadence holds next run. **Idempotency:** skip any
   plan whose `dedupeKey` already has a recorded send.

## Left as hooks for the repo owner

- **The scheduled job itself** (cron / Netlify scheduled function / Supabase cron) — no scheduler
  exists in the repo yet; cadence is designed to be safe at any run frequency (hourly recommended).
- **The candidate-builder query** and the **send-recording event** (both need the DB + Prisma).
- **Follow-up history fields**: `followUpCount` / `lastFollowUpAt` can be derived from
  `KAI_FOLLOWUP_SENT` events (no schema change) or promoted to columns later.
- **Per-tenant quiet-hours / thresholds**: `FollowUpConfig` is passed in; wire it to tenant config
  when per-operator tuning is wanted. The Tenant model has no timezone field today (only
  `defaultLocale`) — add one, or keep the config default (`Asia/Makassar`).
- **An operator-reminder WhatsApp template**: the operator chase currently reuses
  `booking_inquiry_operator`; a purpose-built reminder template would read better (open question).

## Hardening

The engine was put through an adversarial review (four dimensions: anti-spam, WhatsApp compliance,
timezone, money-path). Fixes applied: future-dated / clock-skewed `lastInboundAt` now forces a
template (never free-form outside the window); an empty-string tz falls back to the config default,
not UTC; and a degenerate quiet-hours window fails open so a nudge can never be permanently stalled.
`validateFollowUpConfig(config)` returns config problems for the live layer to assert at startup.
The strict `>` in the already-responded check is intentional — `>=` would permanently suppress
abandoned-trip nudges (a draft's stage time can equal the traveller's creating message); a test locks
this in.

## Tests

`src/core/followup/rules.test.ts` (22 — every suppression reason, the due path, template gating, the
midnight-wrap + degenerate quiet windows, tz fallback + empty-tz, future-inbound, config validation)
and `messages.test.ts` (5 — copy, graceful degradation, no "null", length). 27 total, all passing.
