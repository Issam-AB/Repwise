// One-off: creates (or updates) the `session` video call type that lib/stream.ts ensureSessionCall uses.
// Members-only: a plain user gets no grants on these calls, so only the trainer and client the server adds
// as members can read or join. Members also can't add, change, or remove members. Safe to rerun.
// npx tsx --env-file=.env.local scripts/setup-stream.ts
import { StreamClient } from "@stream-io/node-sdk"

const CALL_TYPE = "session"

const grants = {
  user: [],
  guest: [],
  call_member: [
    "read-call",
    "join-call",
    "end-call",
    "send-audio",
    "send-video",
    "screenshare",
    "send-event",
    "create-call-reaction",
    "pin-call-track-owner",
    "enable-noise-cancellation-any-team",
  ],
}

async function main() {
  const stream = new StreamClient(process.env.NEXT_PUBLIC_STREAM_API_KEY!, process.env.STREAM_API_SECRET!)
  const exists = await stream.video.getCallType({ name: CALL_TYPE }).then(
    () => true,
    () => false,
  )
  if (exists) {
    await stream.video.updateCallType({ name: CALL_TYPE, grants })
    console.log(`updated call type "${CALL_TYPE}"`)
  } else {
    await stream.video.createCallType({ name: CALL_TYPE, grants })
    console.log(`created call type "${CALL_TYPE}"`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
