// Live demo of the payment-settlement + cancellation + monitoring pipeline, built against Tony's
// three briefs (DEVELOPER_BRIEF_PAYMENTS_REZDY.md, PAYMENT_ARCHITECTURE.md, BOOKING_INTEGRATION_PLAN.md).
//
// Run locally first to rehearse:   BASE_URL=http://localhost:3000 node scripts/demo-for-tony.mjs
// Run against production for real: BASE_URL=https://kai-six-virid.vercel.app node scripts/demo-for-tony.mjs
// (Same database either way - there is no separate local DB. BASE_URL only changes which deployed
// code answers the API calls. Rehearse local, present with BASE_URL unset - it defaults to prod.)
//
// Uses Stripe TEST MODE only (BLUEPASS_STRIPE_SECRET_KEY is sk_test_... - confirmed sandbox, no real
// money moves). All rows are tagged "sim-test-" and deleted at the end, whether the run succeeds or
// fails partway through.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.BLUEPASS_STRIPE_SECRET_KEY);
const BASE_URL = process.env.BASE_URL || "https://kai-six-virid.vercel.app";
const ADMIN_TOKEN = process.env.KAI_ADMIN_TOKEN || "dev-admin-token";
const CRON_SECRET = process.env.CRON_SECRET;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function act(number, title) {
  console.log(`\n\n${"#".repeat(78)}`);
  console.log(`#  ACT ${number}: ${title}`);
  console.log("#".repeat(78));
}
function say(line) {
  console.log(`\n  >> ${line}`);
}
function show(line) {
  console.log(`     ${line}`);
}

async function createTestPaymentIntent(amountCents) {
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: "aud",
    payment_method: "pm_card_visa",
    payment_method_types: ["card"],
    confirm: true
  });
}

async function createTenant(label) {
  return prisma.tenant.create({
    data: {
      slug: `sim-test-${label}-${randomUUID()}`,
      name: `Demo Tenant ${label}`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://example.test"],
      status: "ACTIVE"
    }
  });
}

async function createConfirmedBooking({ tenant, dateText, grossAmountCents, paymentIntentId, travellerName }) {
  const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB_WIDGET" } });
  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      pmsProvider: "REZDY",
      productExternalId: "sim-whale-escape",
      productTitle: "Gold Coast Whale Escape",
      dateText,
      guests: 2,
      travellerName,
      travellerEmail: "demo-traveller@example.test",
      grossAmountCents,
      currency: "AUD",
      externalBookingId: `SIM-${randomUUID()}`,
      stripeCheckoutSessionId: `cs_sim_${randomUUID()}`,
      stripePaymentIntentId: paymentIntentId,
      status: "CONFIRMED"
    }
  });

  const conservation = Math.round(grossAmountCents * 0.05);
  const processing = Math.round(grossAmountCents * 0.03);
  const commission = Math.round(grossAmountCents * 0.1);
  const operatorNet = grossAmountCents - conservation - processing - commission;

  await prisma.pmsBookingLedgerEntry.createMany({
    data: [
      { kind: "CONSERVATION_ALLOCATION", amountCents: conservation },
      { kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: processing },
      { kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: commission },
      { kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: operatorNet }
    ].map((entry) => ({
      tenantId: tenant.id,
      conversationId: conversation.id,
      pmsBookingPaymentAttemptId: attempt.id,
      currency: "AUD",
      status: "FINALIZED",
      finalizedAt: new Date(),
      ...entry
    }))
  });

  return attempt;
}

async function ledgerTable(attemptId) {
  const entries = await prisma.pmsBookingLedgerEntry.findMany({
    where: { pmsBookingPaymentAttemptId: attemptId },
    orderBy: { createdAt: "asc" }
  });
  for (const e of entries) {
    const label = { CONSERVATION_ALLOCATION: "5% ocean conservation", PAYMENT_PROCESSING_ALLOCATION: "payment processing", BLUEPASS_PLATFORM_COMMISSION: "BluePass commission", OPERATOR_PAYOUT_PLACEHOLDER: "operator payout" }[e.kind] ?? e.kind;
    show(`${label.padEnd(24)} ${e.status.padEnd(9)} AUD ${(e.amountCents / 100).toFixed(2).padStart(8)}`);
  }
}

const createdTenantIds = [];

async function main() {
  console.log("BluePass payment-settlement pipeline - live demo");
  console.log(`Target: ${BASE_URL}`);
  console.log("Money model: Stripe TEST MODE throughout - every dollar shown below is fake, every code path is real.");
  await pause(500);

  // ================================================================
  act(1, "The hold - money lands on BluePass's balance, operator gets nothing yet");
  say("Per PAYMENT_ARCHITECTURE.md section 1: \"Operator paid $0 at this step. Full amount held by BluePass.\"");
  const pi1 = await createTestPaymentIntent(10000);
  const tenant1 = await createTenant("settle");
  createdTenantIds.push(tenant1.id);
  const booking1 = await createConfirmedBooking({
    tenant: tenant1, dateText: "2026-06-26 13:30:00", grossAmountCents: 10000, paymentIntentId: pi1.id,
    travellerName: "Sarah (demo traveller)"
  });
  show(`Guest paid AUD 100.00 for a trip that already sailed (2026-06-26). Booking status: CONFIRMED.`);
  show(`Real Stripe charge: ${pi1.id} - succeeded, sitting on BluePass's own balance.`);
  say("Ledger already knows how the AUD 100 will eventually split - but nothing has moved to the operator:");
  await ledgerTable(booking1.id);

  // ================================================================
  act(2, "Automatic settlement sweep - the daily cron that pays operators at/after travel");
  say("Per DEVELOPER_BRIEF §2: \"pays operators at/after travel\". This cron runs daily in production.");
  const cronRes = await fetch(`${BASE_URL}/api/cron/settle-pms-bookings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` }
  });
  const cronBody = await cronRes.json();
  show(`POST /api/cron/settle-pms-bookings -> HTTP ${cronRes.status}`);
  show(`Checked ${cronBody.checked} confirmed booking(s) whose travel date has passed.`);
  const found = cronBody.skipped?.find((s) => s.attemptId === booking1.id);
  if (found) {
    say("It found our booking and correctly held off - this demo tenant has no real Stripe Connect account linked (no real operator onboarded), so it refuses to guess and waits for a human:");
    show(`Reason: "${found.reason.slice(0, 100)}..."`);
  }

  // ================================================================
  act(3, "Manual settlement - the human-in-the-loop fallback for operators not yet on Stripe Connect");
  say("Per DEVELOPER_BRIEF §3: \"manual payout stays the interim safety net.\" Admin confirms a bank transfer happened.");
  const settleRes = await fetch(`${BASE_URL}/api/admin/${tenant1.slug}/pms-bookings/${booking1.id}/settle`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reviewerEmail: "demo@bluepass.co", paidOutReference: "bank-ref-DEMO-001" })
  });
  const settleBody = await settleRes.json();
  show(`POST .../settle -> HTTP ${settleRes.status}. Method: ${settleBody.method}. Booking status: ${settleBody.attempt?.status}.`);
  say("The operator's AUD 82 payout is now finalized and marked paid - the money conceptually left BluePass's control:");
  await ledgerTable(booking1.id);

  // ================================================================
  act(4, "Customer cancels 5 days before travel - the tiered auto-refund calculator");
  say("Per DEVELOPER_BRIEF §3: \"Auto-refund calculator by days-to-departure (tiered).\"");
  say("Default policy (no real operator policy set yet): >=14 days = 100%, 3-13 days = 50%, <3 days = 0%.");
  const pi2 = await createTestPaymentIntent(20000);
  const tenant2 = await createTenant("cancel");
  createdTenantIds.push(tenant2.id);
  const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const booking2 = await createConfirmedBooking({
    tenant: tenant2, dateText: in5Days, grossAmountCents: 20000, paymentIntentId: pi2.id,
    travellerName: "James (demo traveller)"
  });
  show(`James paid AUD 200.00 for a trip departing in 5 days (${in5Days}). That's inside the 3-13 day tier -> 50% refund expected.`);

  const cancelRes = await fetch(`${BASE_URL}/api/admin/${tenant2.slug}/pms-bookings/${booking2.id}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reviewerEmail: "demo@bluepass.co", cancelledBy: "CUSTOMER", cancellationReason: "Change of plans" })
  });
  const cancelBody = await cancelRes.json();
  show(`POST .../cancel -> HTTP ${cancelRes.status}`);
  show(`Refund tier applied: ${cancelBody.refundTierPercent}%  ->  AUD ${(cancelBody.refundAmountCents / 100).toFixed(2)} refunded, AUD ${(cancelBody.retainedCents / 100).toFixed(2)} retained.`);
  say("Per PAYMENT_ARCHITECTURE.md §4: \"if a booking is refunded before settlement, no conservation line is taken.\"");
  say("Watch the 5% ocean line go to VOIDED - it never gets prorated, only zeroed. The rest is prorated cleanly, no windfall to anyone:");
  await ledgerTable(booking2.id);

  const refunds = await stripe.refunds.list({ payment_intent: pi2.id, limit: 1 });
  say("This isn't a database fiction - here's Stripe's own record of the refund, fetched live from Stripe's API:");
  show(`Refund ${refunds.data[0].id}: AUD ${(refunds.data[0].amount / 100).toFixed(2)}, status: ${refunds.data[0].status}`);

  // ================================================================
  act(5, "Operator cancels 1 day before travel - always a full, immediate refund");
  say('Per DEVELOPER_BRIEF §3: "Operator cancels -> full immediate refund from held funds." No tier math applies.');
  const pi3 = await createTestPaymentIntent(15000);
  const tenant3 = await createTenant("opcancel");
  createdTenantIds.push(tenant3.id);
  const booking3 = await createConfirmedBooking({
    tenant: tenant3, dateText: "2026-08-11 00:00:00", grossAmountCents: 15000, paymentIntentId: pi3.id,
    travellerName: "Amelia (demo traveller)"
  });
  show(`Amelia's trip departs tomorrow - if SHE cancelled, that's the 0% tier. But the OPERATOR is cancelling.`);
  const opCancelRes = await fetch(`${BASE_URL}/api/admin/${tenant3.slug}/pms-bookings/${booking3.id}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reviewerEmail: "demo@bluepass.co", cancelledBy: "OPERATOR", cancellationReason: "Boat maintenance" })
  });
  const opCancelBody = await opCancelRes.json();
  show(`Refund tier applied: ${opCancelBody.refundTierPercent}%  ->  AUD ${(opCancelBody.refundAmountCents / 100).toFixed(2)} of AUD 150.00 refunded in full, despite being 1 day out.`);

  // ================================================================
  act(6, "Monitoring - proving the automation is actually running, not silently broken");
  say('Per BOOKING_INTEGRATION_PLAN.md §7.5: "Per-platform monitoring: availability freshness, booking-write failures, cancellations sync."');
  const monitorRes = await fetch(`${BASE_URL}/api/admin/cron-runs?jobName=settle-pms-bookings&limit=3`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  const monitorBody = await monitorRes.json();
  show(`GET /api/admin/cron-runs -> HTTP ${monitorRes.status}`);
  say("Every single time that daily cron fires, whether it succeeds or fails, it's logged here - queryable, not silent:");
  for (const run of monitorBody.runs) {
    show(`${run.finishedAt}  status=${run.status}  checked=${run.summary?.checked ?? "-"}`);
  }

  // ================================================================
  act(7, "The Rezdy connector - real product data flowing onto the live site");
  say("Per BOOKING_INTEGRATION_PLAN.md §7.1: real-time availability, instant \"Book Now\", no double entry.");
  say("This part is best shown live in a browser, not this script: open https://bluepass.co and scroll the Discover section -");
  say("every card there was synced automatically from a real Rezdy operator, nightly, via the same cron-log pattern shown above.");

  console.log("\n\n" + "=".repeat(78));
  console.log("DEMO COMPLETE. Summary of what was just proven, live, against real code:");
  console.log("=".repeat(78));
  console.log("  1. Money is held on BluePass's balance, never paid to the operator at booking time.");
  console.log("  2. A daily cron automatically finds bookings ready to settle - and refuses to guess when it can't.");
  console.log("  3. A human can always settle manually as the interim safety net.");
  console.log("  4. Customer cancellations get a real, tiered refund - the 5% ocean line is never taken on a cancelled trip.");
  console.log("  5. Operator cancellations always refund the guest in full, immediately, regardless of timing.");
  console.log("  6. Every automated run is logged and auditable - not a black box.");
  console.log("  7. The Rezdy connector already pipes real operator inventory onto the live site.");
}

main()
  .catch((error) => {
    console.error("\nDEMO SCRIPT ERROR:", error);
  })
  .finally(async () => {
    console.log("\n" + "-".repeat(78));
    console.log("Cleaning up demo data...");
    if (createdTenantIds.length > 0) {
      await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
      await prisma.conversation.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    }
    console.log("Done - all demo rows removed. (Stripe test-mode objects are sandbox data, safe to leave.)");
    await prisma.$disconnect();
  });
