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
- [ ] Partner branch: creator with no clients yet → same track, reassure, capture.
- [ ] Traveller-in-marketplace: "is it safe / refunds?" → human handoff, stay on track.
- [ ] Every operator/partner reply's implicit next-step points deeper into the same track (audit + fix).
- [ ] Bahasa Indonesia variant for the operator opener (operators are Indonesian).
- [ ] Add a test asserting no branch reply exceeds ~320 chars (concise guard).

## Log
- (iterations append here)
- iter1: trimmed operator replies ~20%, numbers preserved, 39 tests green.
- iter2: trimmed partner replies ~20%, catalog flags + phrases intact, 39 green.
- iter3: added operator no-timeline branch, 40 green.
- iter4: license\/cert questions route to vetting answer, 41 green.
- iter5: added partner payout branch (operator-funded + team handoff), 42 green.
