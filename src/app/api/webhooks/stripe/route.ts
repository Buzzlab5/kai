import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getBluePassStripeClient,
  handleBluePassCheckoutSessionCompleted,
  handleBluePassCheckoutSessionExpired,
  resolveBluePassStripeWebhookSecret
} from "@/server/payments/bluepass-stripe";
import { PMS_BOOKING_DIRECT_CHECKOUT_FLOW } from "@/server/payments/bluepass-pms-stripe";
import {
  handlePmsBookingCheckoutSessionCompleted,
  handlePmsBookingCheckoutSessionExpired
} from "@/server/payments/confirm-bluepass-pms-payment";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  // Raw text, not .json() - Stripe's signature check is over the exact request bytes.
  const rawBody = await request.text();

  if (!signature) {
    return NextResponse.json(
      { error: { code: "MISSING_SIGNATURE", message: "Missing Stripe-Signature header." } },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    const stripe = getBluePassStripeClient();
    const webhookSecret = resolveBluePassStripeWebhookSecret();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("bluepass_stripe_webhook.signature_verification_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Stripe webhook signature verification failed." } },
      { status: 400 }
    );
  }

  // A handler failure answers 500 so Stripe redelivers the event (with backoff, for days). That is
  // safe because every handler is idempotent: a redelivery of a finished event is a no-op. Answering
  // 200 here would mean a transient DB error leaves a paid booking's ledger never finalized.
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kaiFlow === PMS_BOOKING_DIRECT_CHECKOUT_FLOW) {
        await handlePmsBookingCheckoutSessionCompleted(session);
      } else {
        await handleBluePassCheckoutSessionCompleted(session);
      }
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kaiFlow === PMS_BOOKING_DIRECT_CHECKOUT_FLOW) {
        await handlePmsBookingCheckoutSessionExpired(session);
      } else {
        await handleBluePassCheckoutSessionExpired(session);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("bluepass_stripe_webhook.handler_failed", { eventType: event.type, error: message });
    return NextResponse.json({ received: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
