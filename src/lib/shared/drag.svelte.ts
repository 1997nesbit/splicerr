import { startDrag } from "@crabnebula/tauri-plugin-drag"
import { join, appCacheDir } from "@tauri-apps/api/path"
import { exists, create, mkdir, readFile, readDir, stat, remove } from "@tauri-apps/plugin-fs"
import { encodeSampleWav } from "./files.svelte"
import { semitonesFor } from "./transpose.svelte"
import { loading } from "./loading.svelte"
import { toast, dismissToast } from "./toasts.svelte"
import type { SampleAsset, PackAsset } from "$lib/splice/types"

async function dragWavDir(): Promise<string> {
    const dir = await join(await appCacheDir(), "drag-wavs")
    if (!(await exists(dir))) await mkdir(dir)
    return dir
}

async function dragIconDir(): Promise<string> {
    const dir = await join(await appCacheDir(), "drag-icons")
    if (!(await exists(dir))) await mkdir(dir)
    return dir
}

// Downloads the pack cover art into AppCache/drag-icons/ so the drag icon can
// be built without writing anything to the user's samples_dir.
async function fetchPackCoverToCache(pack: PackAsset): Promise<string | null> {
    try {
        const dir = await dragIconDir()
        const coverPath = await join(dir, `${pack.uuid}_cover.jpg`)
        if (await exists(coverPath)) return coverPath
        const response = await fetch(pack.files[0].url)
        if (!response.ok) return null
        const file = await create(coverPath)
        await file.write(new Uint8Array(await response.arrayBuffer()))
        await file.close()
        return coverPath
    } catch {
        return null
    }
}

// Strips characters that are illegal in Windows/macOS/Linux filenames.
function sanitizeName(name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "unknown"
}

// All drag WAVs go to AppCache/drag-wavs/<pack-name>/<sample-name>.wav so the
// DAW sees readable folder and file names. Semitones suffix is appended when
// the sample is transposed so pitched variants don't collide with the original.
async function saveSampleToAppCache(
    sampleAsset: SampleAsset,
    semitones: number
): Promise<string> {
    const pack = sampleAsset.parents.items[0]
    const packFolder = sanitizeName(pack?.name.split("/").at(-1) ?? "unknown")
    const displayName = sampleAsset.name.split("/").at(-1) ?? sampleAsset.name
    const baseName = sanitizeName(displayName.replace(/\.[^.]+$/, ""))
    const suffix = semitones !== 0 ? ` (${semitones > 0 ? "+" : ""}${semitones}st)` : ""
    const sampleDir = await join(await dragWavDir(), packFolder)
    if (!(await exists(sampleDir))) await mkdir(sampleDir)
    const wavPath = await join(sampleDir, `${baseName}${suffix}.wav`)
    if (!(await exists(wavPath))) {
        const wavData = await encodeSampleWav(sampleAsset, semitones)
        const file = await create(wavPath)
        await file.write(wavData)
        await file.close()
    }
    return wavPath
}

async function createDragIcon(
    packImagePath: string,
    packId: string
): Promise<string> {
    const dir = await dragIconDir()
    const iconPath = await join(dir, `${packId}.png`)

    if (!(await exists(iconPath))) {
        const imageData = await readFile(packImagePath)
        const buffer = new ArrayBuffer(imageData.byteLength)
        const view = new Uint8Array(buffer)
        view.set(imageData)
        const resizedImageData = await resizeImageToCorner(buffer)
        const file = await create(iconPath)
        await file.write(resizedImageData)
        await file.close()
    }

    return iconPath
}

async function createInvisibleIcon(): Promise<string> {
    const dir = await dragIconDir()
    const iconPath = await join(dir, "invisible.png")

    if (!(await exists(iconPath))) {
        const transparentPng = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
            0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x02, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
            0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ])

        const file = await create(iconPath)
        await file.write(transparentPng)
        await file.close()
    }

    return iconPath
}

async function resizeImageToCorner(
    imageBuffer: ArrayBuffer
): Promise<Uint8Array> {
    return new Promise((resolve) => {
        const blob = new Blob([imageBuffer])
        const img = new Image()
        const iconSize = 64
        img.onload = () => {
            const canvasWidth = iconSize * 2
            const canvasHeight = iconSize * 2.5
            const canvas = document.createElement("canvas")
            const ctx = canvas.getContext("2d")!

            canvas.width = canvasWidth
            canvas.height = canvasHeight

            // Transparent background
            ctx.clearRect(0, 0, canvasWidth, canvasHeight)

            // Position the image in the top-right corner of the canvas
            const x = canvasWidth - iconSize
            const y = 0

            ctx.drawImage(img, x, y, iconSize, iconSize)

            canvas.toBlob((blob) => {
                blob!.arrayBuffer().then((buffer) => {
                    resolve(new Uint8Array(buffer))
                })
            }, "image/png")
        }
        img.src = URL.createObjectURL(blob)
    })
}

type DragData = { path: string; iconPath: string }

// Cache the on-disk WAV + drag icon per sample (keyed by uuid + transpose, since
// the saved path depends on the transpose suffix), so that the actual drag can be
// started synchronously.
const dragCache = new Map<string, DragData>()
const inFlight = new Map<string, Promise<DragData | null>>()

const cacheKey = (s: SampleAsset) => `${s.uuid}:${semitonesFor(s)}`

/**
 * Prepares a sample for dragging: descrambles + writes the WAV and builds the
 * drag icon, caching the result. Idempotent and deduplicated, and cheap once the
 * files already exist on disk. Call this ahead of the drag gesture (on hover /
 * pointerdown) so `handleSampleDrag` has everything ready synchronously.
 */
export function prefetchSampleDrag(sampleAsset: SampleAsset): Promise<DragData | null> {
    const key = cacheKey(sampleAsset)
    const cached = dragCache.get(key)
    if (cached) return Promise.resolve(cached)
    const existing = inFlight.get(key)
    if (existing) return existing

    const p = (async () => {
        loading.samples.add(sampleAsset.uuid)
        loading.samplesCount++
        try {
            // Drag WAVs always go to AppCache/drag-wavs/ — never the user's samples_dir.
            // The Download button is the intentional "save permanently" action.
            const path = await saveSampleToAppCache(sampleAsset, semitonesFor(sampleAsset))

            const pack = sampleAsset.parents.items[0] as PackAsset
            const coverPath = await fetchPackCoverToCache(pack)
            const iconPath = coverPath
                ? await createDragIcon(coverPath, pack.uuid)
                : await createInvisibleIcon()

            const data = { path, iconPath }
            dragCache.set(key, data)
            return data
        } catch (e) {
            console.error("⚠️ Failed preparing sample for drag", e)
            return null
        } finally {
            loading.samples.delete(sampleAsset.uuid)
            loading.samplesCount--
            inFlight.delete(key)
        }
    })()
    inFlight.set(key, p)
    return p
}

/**
 * dragstart handler. MUST stay synchronous: on macOS the native drag session
 * snapshots `NSApp.currentEvent`, so any `await` before `startDrag` leaves it
 * stale/nil and crashes AppKit (EXC_BAD_ACCESS in NSViewAlignRect). We therefore
 * only start the drag when the files are already prepared; otherwise we kick off
 * the prefetch so the next gesture works.
 */
// Single-slot drag toast state: only one "preparing" notice is ever shown.
// Switching to a different sample replaces the existing toast instead of stacking.
let activeDragToastId: string | null = null
let activeDragUuid: string | null = null

/**
 * Cleans up stale drag cache files on startup. WAVs older than 7 days and
 * icons older than 30 days are deleted; recently used entries stay warm across
 * sessions so the next drag is instant.
 */
export async function cleanupDragCache(): Promise<void> {
    const now = Date.now()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    // Prune individual files older than maxAge, then remove empty parent dirs.
    async function pruneFiles(dir: string, maxAge: number) {
        if (!(await exists(dir))) return
        for (const packEntry of await readDir(dir)) {
            try {
                const packPath = await join(dir, packEntry.name)
                const packInfo = await stat(packPath)
                if (!packInfo.isDirectory) {
                    // flat file (old cache format) — prune by its own mtime
                    if (packInfo.mtime && now - packInfo.mtime.getTime() > maxAge) {
                        await remove(packPath)
                    }
                    continue
                }
                // pack subfolder — prune individual files inside it
                for (const fileEntry of await readDir(packPath)) {
                    try {
                        const filePath = await join(packPath, fileEntry.name)
                        const fileInfo = await stat(filePath)
                        if (fileInfo.mtime && now - fileInfo.mtime.getTime() > maxAge) {
                            await remove(filePath)
                        }
                    } catch {}
                }
                // remove the pack folder itself if it is now empty
                const remaining = await readDir(packPath)
                if (remaining.length === 0) await remove(packPath)
            } catch {}
        }
    }

    async function pruneDir(dir: string, maxAge: number) {
        if (!(await exists(dir))) return
        for (const entry of await readDir(dir)) {
            try {
                const filePath = await join(dir, entry.name)
                const info = await stat(filePath)
                if (info.mtime && now - info.mtime.getTime() > maxAge) {
                    await remove(filePath, { recursive: true })
                }
            } catch {}
        }
    }

    try {
        const cacheDir = await appCacheDir()
        await pruneFiles(await join(cacheDir, "drag-wavs"), sevenDays)
        await pruneDir(await join(cacheDir, "drag-icons"), thirtyDays)
    } catch (e) {
        console.warn("⚠️ Drag cache cleanup failed", e)
    }
}

export function handleSampleDrag(event: DragEvent, sampleAsset: SampleAsset) {
    event.preventDefault()
    const data = dragCache.get(cacheKey(sampleAsset))
    if (data) {
        // Ready immediately — clear any leftover preparing toast and start the drag.
        if (activeDragToastId) { dismissToast(activeDragToastId); activeDragToastId = null }
        activeDragUuid = null
        startDrag({ item: [data.path], icon: data.iconPath })
        return
    }

    const filename = sampleAsset.name.split("/").pop() ?? sampleAsset.name

    // Same sample already being prepared — don't create a duplicate toast.
    if (activeDragUuid === sampleAsset.uuid) return

    // Replace the previous preparing toast instead of stacking a new one.
    if (activeDragToastId) dismissToast(activeDragToastId)

    activeDragUuid = sampleAsset.uuid
    activeDragToastId = toast({
        title: `Preparing "${filename}"`,
        // progress with total=0 triggers the spinner + indeterminate bar in the toaster
        progress: { received: 0, total: 0, unit: "bytes" },
        duration: 0,
    })

    const capturedToastId = activeDragToastId
    const capturedUuid = sampleAsset.uuid

    prefetchSampleDrag(sampleAsset).then((result) => {
        dismissToast(capturedToastId)
        if (activeDragToastId === capturedToastId) activeDragToastId = null

        // Only notify if the user hasn't moved on to preparing a different sample.
        if (result && activeDragUuid === capturedUuid) {
            activeDragUuid = null
            toast({
                title: `"${filename}" is ready`,
                description: "Drag it to your DAW now.",
                variant: "success",
                duration: 8000,
            })
        }
    })
}
