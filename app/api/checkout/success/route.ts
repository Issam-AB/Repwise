import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"
import { afterPurchase, fulfillCheckout } from "@/lib/checkout"
import { stripe } from "@/lib/stripe"

// Stripe sends the buyer here after paying. The session is fetched from Stripe (never trusted from the URL), so
// this is as safe as the webhook, and fulfilling here means the purchase shows up instantly, even if the webhook
// is late or not forwarded in local dev. fulfillCheckout is idempotent, so both running is fine.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("session_id") ?? ""
  if (!id.startsWith("cs_")) redirect("/")

  const session = await stripe().checkout.sessions.retrieve(id)
  const meta = await fulfillCheckout(session)
  // Not paid yet (e.g. a delayed payment method): the webhook will record it once it settles
  redirect(meta ? afterPurchase(meta) : "/library")
}
