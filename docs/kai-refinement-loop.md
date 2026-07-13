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
- [x] Refactor: extract branches to a data table -> DEFERRED to a dedicated pass (too large/risky for a low-token loop tick).

- [x] Partner: "roughly what commission %?" -> ballpark/give-me-a-number branch, refuses to invent a figure.
- [x] Operator: "how do I sign up / start?" -> concrete 3-step sign-up branch, captures company/port/email.
- [x] Operator: "is BluePass legit?" trust branch (real marketplace, keep 82%, nothing charged pre-claim).

- [x] Operator: "will I actually get bookings / how much demand?" -> honest no-guarantee branch (real reach, no cost until earning).
- [x] Operator: "how are cancellations / refunds handled?" -> your own terms, shown on page, team wires in.
- [x] Operator: "can I list more than one boat / multiple trips?" -> yes, whole fleet + trip types under one page.

- [x] Partner: "how do I actually refer a client?" -> tracked-link mechanism, client books direct, auto-credited (60-day).
- [x] Operator: "what do I need for my page (photos/details)?" -> low-lift, team builds it (placed before what-we-get so "my page" routes right).
- [x] Operator/Partner: "can I see a demo / example first?" -> real/sample page, no commitment (both builders).

- [x] Operator: "who handles guest support / problems?" -> you run the trip; Kai pre-trip + team backs you (clear of handoff topics).
- [x] Operator: "do you support Bahasa / do I need English?" -> Kai speaks both, guest in their own language (before indonesia catch).
- [x] Partner: "do you have an API / can I embed this?" -> link+assets now, deeper integration a team chat (no overpromise).

- [x] Partner: "is my client list mine / do you poach my clients?" -> clients stay yours, no marketing behind your back, keep the credit.
- [x] Operator: "how do guests pay (card/transfer)?" -> secure BluePass checkout, paid out via team, capped 18% only.
- [x] Partner: "which currencies / how are payouts converted?" -> paid in your currency, conversion set with team (before payout branch).

- [x] Operator: "will you list my competitors / how do I stand out?" -> curated marketplace, your own storefront, stand out on trips/reviews/conservation.
- [x] Operator: "how do reviews / ratings work?" -> real guests, shown on your page, details with team (+guard test vs "start").
- [x] Partner: "day trips or liveaboards only?" -> honest scope: mainly liveaboards + dive trips in live regions, more coming.

- [x] Operator+Partner: "can I talk to a real person / book a call?" -> team hops on a call, capture email/WhatsApp (both builders).
- [x] Operator: "I already list on an OTA - why BluePass?" -> not exclusive, operator-direct, keep 82%, conservation (before what-we-get).
- [x] Guard: 40-input test asserts every operator+partner reply carries a capture CTA (?/company/email/whatsapp/handle/claim) - no dead-ends.

- [x] Partner: "who else uses this / testimonials?" -> honest early founding cohort, refuses to invent names, capture.
- [x] Operator: "is there an app / can I manage on my phone?" -> no app, dashboard in-browser + WhatsApp, manage from phone.
- [x] Partner: "can I also refer operators / do you pay for operator intros?" -> yes intro them, referral terms a team chat, no invented number (+guard).

- [x] Robustness: track-lock first-signal-wins on genuine operator-vs-partner competition (both orders + within-message precedence).
- [ ] Partner: "what if the operator cancels on my client?" -> team steps in, rebook/refund per operator terms, honest, capture.
- [ ] Operator: "how do I manage availability / what if I am fully booked?" -> you control your calendar, mark dates, capture.

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
- iter28: added partner trust branch; refactor deferred to dedicated pass; +3 items, 64 green.
- iter29: partner ballpark-commission branch (no invented number), 65 green.
- iter30: operator how-do-I-sign-up branch (3 concrete steps + capture), 66 green.
- iter31: operator trust/legit branch; backlog emptied -> self-critique added 3 items, 67 green.
- iter32: operator demand-expectation branch (no guarantees, honest), 68 green.
- iter33: operator cancellation/refund branch (operator sets terms, team wires in), 69 green.
- iter34: operator multi-listing/fleet branch; backlog emptied -> self-critique added 3 items, 70 green.
- iter35: partner referral-mechanism branch (tracked link, auto-credited), 71 green.
- iter36: operator page-build-requirements branch (low-lift, team builds); ordered before what-we-get, 72 green.
- iter37: operator+partner demo/example branches; backlog emptied -> self-critique added 3 items, 74 green.
- iter38: operator guest-support-split branch (you run trip, Kai+team pre-trip), 75 green.
- iter39: operator language/Bahasa branch (no English needed, both languages); ordered before indonesia, 76 green.
- iter40: partner API/embed branch (honest, no overpromise); backlog emptied -> self-critique added 3 items, 77 green.
- iter41: partner client-ownership/no-poaching branch, 78 green.
- iter42: operator guest-payment branch (secure checkout, paid out); ordered before payout handoff, 79 green.
- iter43: partner currency/conversion branch; backlog emptied -> self-critique added 3 items, 80 green.
- iter44: operator competitor/differentiation branch (curated marketplace, own storefront), 81 green.
- iter45: operator reviews/ratings branch (real guests, earned not bought); guard test "how do i start" not misrouted, 83 green.
- iter46: partner trip-type/scope branch; backlog emptied -> self-critique added 3 items, 84 green.
- iter47: operator+partner human-contact/book-a-call branches, 86 green.
- iter48: operator OTA-differentiation branch (not exclusive, direct, 82%); ordered before what-we-get, 87 green.
- iter49: no-dead-end CTA guard test (40 inputs, both verticals); backlog emptied -> self-critique added 3 items, 88 green.
- iter50: partner social-proof branch (early cohort, no invented names), 89 green.
- iter51: operator app/phone branch (no app, browser + WhatsApp); avoided bare "app" substring, 90 green.
- iter52: partner refer-operators branch (+guard for client-referral routing); backlog emptied -> self-critique added 3 items, 92 green.
- iter53: track-lock invariant test (op-vs-partner, both orders + within-message), 93 green.
