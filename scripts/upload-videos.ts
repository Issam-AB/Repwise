// One-off: copies the demo lesson videos (lib/mock-data lessonVideos) to ImageKit as private files at
// lessonVideoPath(), where the seed points every demo lesson. Skips files already there, so it's safe to rerun.
// npx tsx --env-file=.env.local scripts/upload-videos.ts
import { basename, dirname } from "node:path"
import { lessonVideoPath, lessonVideos } from "../lib/mock-data"

// The server-side API uses Basic auth: the private key is the username, the password stays empty
const authorization = `Basic ${Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64")}`
const FOLDER = "/lessons/demo"

// Asks the media library, not the CDN: the CDN briefly caches 404s, and private files aren't public anyway
async function existing() {
  const query = new URLSearchParams({ path: FOLDER, type: "file", limit: "1000" })
  const res = await fetch(`https://api.imagekit.io/v1/files?${query}`, { headers: { authorization } })
  if (!res.ok) throw new Error(`List ${FOLDER}: ${res.status} ${await res.text()}`)
  return new Set(((await res.json()) as { filePath: string }[]).map((f) => f.filePath))
}

async function main() {
  const have = await existing()
  for (const [programId, clips] of Object.entries(lessonVideos)) {
    for (const [i, source] of clips.entries()) {
      const path = lessonVideoPath(programId, i + 1)!
      if (have.has(path)) {
        console.log(`skip    ${path}`)
        continue
      }
      const clip = await fetch(source)
      if (!clip.ok) throw new Error(`Download ${source}: ${clip.status}`)
      const form = new FormData()
      form.append("file", new Blob([await clip.arrayBuffer()], { type: "video/mp4" }))
      form.append("fileName", basename(path))
      form.append("folder", dirname(path))
      form.append("useUniqueFileName", "false")
      form.append("isPrivateFile", "true")
      const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", headers: { authorization }, body: form })
      if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
      console.log(`upload  ${path}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
