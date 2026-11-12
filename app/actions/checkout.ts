"use server"

import * as Sentry from "@sentry/nextjs"
import { and, eq, gt, ne, sql } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import type Stripe from "stripe"
import type { ActionResult } from "@/components/action-form"
import { requireProfile, requireUser } from "@/lib/auth"
import { releaseHold } from "@/lib/checkout"
import { db } from "@/lib/db"
import { profiles, programs, slots } from "@/lib/db/schema"
import { ownsProgram, slotIsOpen } from "@/lib/queries"
import { stripe } from "@/lib/stripe"
import { imageUrl, isUuid } from "@/lib/utils"

// Stripe's shortest Checkout lifetime is 30 minutes. The slot hold outlasts it by a minute, so a slot can't be
// handed to someone else while its Checkout page can still be paid.
const CHECKOUT_MINUTES = 30
const HOLD_MINUTES = CHECKOUT_MINUTES + 1

// Where Stripe sends the buyer back. The success route records the purchase (the webhook does too; whichever runs
// first wins), so purchases work locally even without `stripe listen`.
async function returnUrls(back: string) {
  const origin = (await headers()).get("origin") ?? "http://localhost:3000"
  return {
    success_url: `${origin}/api/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/api/checkout/cancel?session_id={CHECKOUT_SESSION_ID}&back=${encodeURIComponent(back)}`,
  }
}

// Every field the webhook needs to fulfill rides along as metadata
async function createCheckout(params: {
  name: string
  image?: string | null
  amountCents: number
  email: string
  metadata: Record<string, string>
  back: string
}) {
  return stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: params.amountCents,
          product_data: { name: params.name, images: params.image ? [params.image] : undefined },
        },
      },
    ],
    customer_email: params.email,
    metadata: params.metadata,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
    ...(await returnUrls(params.back)),
  })
}

export async function buyProgram(programId: string): Promise<ActionResult> {
  const me = await requireProfile()
  if (!isUuid(programId)) return { error: "Program not found" }

  const [program] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.published, true)))
  if (!program) return { error: "This program isn't available" }
  if (program.trainerId === me.userId) return { error: "You can't buy your own program" }
  if (await ownsProgram(me.userId, programId)) return { error: "You already own this program" }

  let checkout: Stripe.Checkout.Session
  try {
    checkout = await createCheckout({
      name: program.title,
      image: program.coverUrl && imageUrl(program.coverUrl, [{ width: 800 }]),
      amountCents: program.priceCents,
      email: (await requireUser()).email,
      metadata: { kind: "program", clientId: me.userId, trainerId: program.trainerId, programId },
      back: `/programs/${programId}`,
    })
  } catch (error) {
    console.error("[checkout] couldn't create a Stripe Checkout session", error)
    Sentry.captureException(error)
    return { error: "Couldn't start checkout. Try again." }
  }
  Sentry.logger.info("Checkout started", { kind: "program", clientId: me.userId, itemId: programId })
  redirect(checkout.url!)
}

export async function bookSlot(slotId: string): Promise<ActionResult> {
  const me = await requireProfile()
  if (!isUuid(slotId)) return { error: "Slot not found" }

  // One atomic UPDATE: when two people race for a slot, exactly one gets a row back. The hold keeps it off the
  // market while the winner pays; an abandoned hold simply lapses.
  const [slot] = await db
    .update(slots)
    .set({ status: "held", clientId: me.userId, heldUntil: sql`now() + make_interval(mins => ${HOLD_MINUTES})` })
    .where(and(eq(slots.id, slotId), ne(slots.trainerId, me.userId), gt(slots.startsAt, sql`now()`), slotIsOpen))
    .returning()
  if (!slot) {
    Sentry.logger.warn("Slot no longer bookable", { slotId, clientId: me.userId })
    return { error: "That slot just got taken. Pick another time." }
  }

  const [trainer] = await db
    .select({ name: profiles.name, avatarUrl: profiles.avatarUrl, priceCents: profiles.sessionPriceCents })
    .from(profiles)
    .where(eq(profiles.userId, slot.trainerId))

  let checkout: Stripe.Checkout.Session
  try {
    if (!trainer.priceCents) throw new Error(`Trainer ${slot.trainerId} has no session price`)
    checkout = await createCheckout({
      name: `1:1 session with ${trainer.name}`,
      image: trainer.avatarUrl && imageUrl(trainer.avatarUrl, [{ width: 800 }]),
      amountCents: trainer.priceCents,
      email: (await requireUser()).email,
      metadata: { kind: "session", clientId: me.userId, trainerId: slot.trainerId, slotId },
      back: `/trainers/${slot.trainerId}`,
    })
  } catch (error) {
    console.error("[checkout] couldn't create a Stripe Checkout session", error)
    Sentry.captureException(error)
    await releaseHold(slotId, me.userId)
    return { error: "Couldn't start checkout. Try again." }
  }
  Sentry.logger.info("Checkout started", { kind: "session", clientId: me.userId, itemId: slotId })
  redirect(checkout.url!)
}
