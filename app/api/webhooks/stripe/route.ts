import * as Sentry from "@sentry/nextjs"
import type Stripe from "stripe"
import { fulfillCheckout, releaseCheckout } from "@/lib/checkout"
import { stripe } from "@/lib/stripe"

// Stripe's source of truth for payments. Locally: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
// prints the STRIPE_WEBHOOK_SECRET to use.
export async function POST(request: Request) {
  // The signature covers the exact bytes Stripe sent, so read the raw body, never parsed JSON
  const body = await request.text()
  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(body, request.headers.get("stripe-signature") ?? "", process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (error) {
    Sentry.logger.warn("Stripe webhook rejected", { reason: error instanceof Error ? error.message : String(error) })
    return new Response("Invalid signature", { status: 400 })
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfillCheckout(event.data.object)
      break
    case "checkout.session.expired":
      await releaseCheckout(event.data.object)
      break
  }
  // Anything else (or a repeat delivery) is acknowledged so Stripe stops retrying
  return new Response(null, { status: 200 })
}
