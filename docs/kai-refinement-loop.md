# Kai triage refinement loop — autonomous protocol

Runs via `/loop` (self-paced). Goal: refine the persona decision tree + messaging so every
conversation stays on one track, with concise, non-dead-end replies. Runs unattended.

## Per-iteration protocol (do exactly one)
1. Read this file's Backlog. Pick the top unchecked item.
2. Implement it — **small, single-focus** edit to `src/core/bluepass/triage.ts` (and `lead.ts` if
   needed). Keep Kai's messages concise; no token bloat.
3. Add/adjust a test in `src/core/bluepass/triage.test.ts` proving it.
4. Run `npx vitest run src/core/bluepass` — **must stay green**. If red, fix or revert; never commit red.
5. `git commit` on `tony/kai-triage-refine`, one line, imperative.
6. Check the item off in Backlog; append a one-line note to Log.
7. Schedule the next iteration.

## Guardrails
- One item per iteration. Small diffs.
- Tests green before every commit. Never break track-lock (first-signal-wins).
- Every operator/partner terminal branch ends with the same CTA: company + one reachable channel.
- Every `suggested_replies` / next-step stays IN the current track — never cross-vertical, never a dead-end.
- Numbers stay honest: 82% / 18% (5/5/3/5); never invent commission %; never promise approval/timelines.
- No emojis. Concise replies (aim ≤ 2 sentences per branch where possible).

## Convergence
- When all Backlog items are checked: do ONE self-critique pass — read the playbooks, list up to 3
  concrete gaps as new Backlog items. If none meet the bar, write "CONVERGED" to Log and stop the loop.

## Backlog
- [x] Trim level-2 operator replies ~20% shorter without losing the honest numbers.
- [x] Trim level-2 partner replies ~20% shorter.
- [x] Operator branch: "how long until approved?" -> honest no-timeline + capture.
- [x] Operator branch: "do I need a license / Green Fins?" -> vetting answer + capture.
- [x] Partner branch: "how do I get paid?" -> mechanism (funded from operator side) + human handoff.
- [x] Partner branch: creator with no clients yet -> same track, reassure, capture.
- [x] Safety/medical/legal handoff added to operator+partner playbooks (traveller-flow variant = separate flow task).
- [x] Every operator/partner reply points deeper into the same track (conservation + commission fixed).
- [x] Bahasa Indonesia operator opener + classifier signals.
- [x] Add a test asserting no branch reply exceeds ~320 chars (concise guard).

- [x] Tighten concise ceiling to 320: partner home pitch + conservation + Bahasa opener trimmed.
- [x] Partner: "which regions/destinations?" -> honest Indonesia-first, Komodo + Raja live.
- [x] Operator: "what does my page look like / a dashboard?" -> what-you-get answer + capture.

- [x] Operator: "can I set my own prices/rates?" -> you set your rate, keep 82%.
- [x] Partner: "any cost / sign-up fee to join?" -> no cost, funded from operator side.
- [x] Operator: "can I pause / leave anytime?" -> no lock-in, honest, capture.

- [x] Partner: "how do I track my bookings/earnings?" -> tracked link + dashboard, capture.
- [x] Operator: "where do bookings come from?" -> Kai + partner network, capture.
- [x] Partner: "can I co-brand / white-label?" -> co-brand impact assets yes, capture.

- [x] Partner: "how does attribution?" -> 60-day window + manual code.
- [x] Operator: "do you integrate with my booking system / Rezdy?" -> team handles it, honest.
- [x] Partner: "where do I get the marketing assets?" -> assets in dashboard, capture.

- [x] Partner: "can I do group / charter bookings for clients?" -> yes, group holds via team.
- [x] Operator: "what happens after a guest inquires?" -> Kai pre-qualifies then hands to you.
- [x] Partner: "is there a minimum volume to join?" -> no minimum, capture.

- [x] Operator: "is my data / are my guests private?" -> honest + team handoff.
- [x] Partner: "how soon can I go live?" -> one-click claim, instant.
- [ ] Refactor: extract operator/partner keyword branches to a data-driven table (behaviour-preserving).

## Log
- (iterations append here)
- iter1: trimmed operator replies ~20%, numbers preserved, 39 tests green.
- iter2: trimmed partner replies ~20%, catalog flags + phrases intact, 39 green.
- iter3: added operator no-timeline branch, 40 green.
- iter4: license\/cert questions route to vetting answer, 41 green.
- iter5: added partner payout branch (operator-funded + team handoff), 42 green.
- iter6: added partner creator-no-clients branch, 43 green.
- iter7: shared safety\/medical\/legal human-handoff in operator+partner playbooks, 44 green.
- iter8: added same-track next-step to partner conservation + commission replies, 45 green.
- iter9: Bahasa Indonesia operator opener + classifier signals, 46 green.
- iter10: concise-length guard (<=360) + trimmed commission; self-critique added 3 items, 47 green.
- iter11: trimmed 3 long replies, guard tightened to 320, 47 green.
- iter12: added partner regions\/coverage branch (Indonesia-first), 48 green.
- iter13: page/dashboard -> what-you-get; self-critique added 3 items, 49 green.
- iter14: added operator own-pricing branch, 50 green.
- iter15: added partner no-cost-to-join branch, 51 green.
- iter16: operator no-lock-in branch; self-critique added 3 items, 52 green.
- iter17: added partner bookings\/earnings dashboard branch, 53 green.
- iter18: added operator demand-channel branch, 54 green.
- iter19: partner co-brand/white-label branch; self-critique added 3 items, 55 green.
- iter20: added partner attribution\/referral-window branch, 56 green.
- iter21: added operator PMS-integration branch, 57 green.
- iter22: partner marketing-assets branch; self-critique added 3 items, 58 green.
- iter23: added partner group\/charter branch, 59 green.
- iter24: added operator inquiry-handoff branch, 60 green.
- iter25: partner no-minimum-volume branch; self-critique added 3 items (incl. refactor), 61 green.
- iter26: added operator data\/privacy branch, 62 green.
- iter27: added partner go-live-fast branch, 63 green.
