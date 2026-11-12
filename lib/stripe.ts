import "server-only"
import Stripe from "stripe"

// Created on first use: `next build` imports modules without the runtime secrets
let client: Stripe | undefined
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set: add your Stripe test key to .env.local")
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY))
}
