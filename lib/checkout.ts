import "server-only"
import * as Sentry from "@sentry/nextjs"
import { and, eq } from "drizzle-orm"
import type Stripe from "stripe"
import { db } from "@/lib/db"
import { purchases, slots } from "@/lib/db/schema"
import { isUuid } from "@/lib/utils"

// Shared by the Stripe webhook and the success/cancel return routes. Not a server action: nothing here may be
// callable from the browser.

type Metadata = { kind: "program" | "session"; clientId: string; trainerId: string; programId?: string; slotId?: string }

function metadataOf(session: Stripe.Checkout.Session): Metadata | null {
  const m = session.metadata ?? {}
  if (m.kind !== "program" && m.kind !== "session") return null
  if (!isUuid(m.clientId ?? "") || !isUuid(m.trainerId ?? "")) return null
  if (m.kind === "program" && !isUuid(m.programId ?? "")) return null
  if (m.kind === "session" && !isUuid(m.slotId ?? "")) return null
  return m as Metadata
}

// Records a paid Checkout session and books its slot. Idempotent: a repeat stripeSessionId (or a second copy of
// the same program) inserts nothing, so the webhook and the success route can both call it.
// Returns the metadata, or null when the session isn't a paid Repwise checkout.
export async function fulfillCheckout(session: Stripe.Checkout.Session) {
  const meta = metadataOf(session)
  if (!meta || session.payment_status !== "paid") return null

  const purchase = {
    kind: meta.kind,
    clientId: meta.clientId,
    trainerId: meta.trainerId,
    programId: meta.programId ?? null,
    slotId: meta.slotId ?? null,
    amountCents: session.amount_total ?? 0,
    stripeSessionId: session.id,
  }
  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx.insert(purchases).values(purchase).onConflictDoNothing().returning({ id: purchases.id })
    if (row && purchase.slotId) {
      await tx
        .update(slots)
        .set({ status: "booked", heldUntil: null })
        .where(and(eq(slots.id, purchase.slotId), eq(slots.clientId, purchase.clientId)))
    }
    return Boolean(row)
  })
  // One wide event per checkout, so Sentry Logs can answer "what sold, for how much, to whom"
  if (inserted) {
    Sentry.logger.info("Purchase fulfilled", {
      kind: purchase.kind,
      amountCents: purchase.amountCents,
      clientId: purchase.clientId,
      trainerId: purchase.trainerId,
      itemId: purchase.programId ?? purchase.slotId ?? "",
      stripeSessionId: session.id,
    })
  }
  return meta
}

// Puts a held slot back on the market (checkout abandoned, expired, or failed to start). A booked slot stays booked.
export async function releaseHold(slotId: string, clientId: string) {
  await db
    .update(slots)
    .set({ status: "open", clientId: null, heldUntil: null })
    .where(and(eq(slots.id, slotId), eq(slots.clientId, clientId), eq(slots.status, "held")))
}

// Gives back the slot of an unpaid session (expired, or cancelled by the buyer)
export async function releaseCheckout(session: Stripe.Checkout.Session) {
  const meta = metadataOf(session)
  if (meta?.slotId && session.payment_status !== "paid") await releaseHold(meta.slotId, meta.clientId)
}

// Where the buyer lands after paying
export const afterPurchase = (meta: Metadata) => (meta.kind === "program" ? `/programs/${meta.programId}` : "/library")
