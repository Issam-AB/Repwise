import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"
import { releaseCheckout } from "@/lib/checkout"
import { stripe } from "@/lib/stripe"

// The buyer clicked "back" on the Checkout page. Expire the session so it can't be paid later, and give the slot
// back right away instead of leaving it held for 30 minutes.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const id = params.get("session_id") ?? ""
  // Only same-site paths, so this can't be used as an open redirect
  const back = params.get("back") ?? ""
  const destination = back.startsWith("/") && !back.startsWith("//") ? back : "/"

  if (id.startsWith("cs_")) {
    const session = await stripe().checkout.sessions.retrieve(id)
    if (session.status === "open") {
      await releaseCheckout(await stripe().checkout.sessions.expire(id))
    }
  }
  redirect(destination)
}
