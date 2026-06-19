import { appConfigDir, join } from "@tauri-apps/api/path"
import { exists, mkdir, writeFile, readFile, remove } from "@tauri-apps/plugin-fs"
import { fetch } from "@tauri-apps/plugin-http"
import { descrambleSample } from "$lib/splice/descrambler"
import type { SampleAsset } from "$lib/splice/types"

const CACHE_DIRNAME = "liked-cache"

async function cacheDir(): Promise<string> {
    return join(await appConfigDir(), CACHE_DIRNAME)
}

async function cachedFilePath(uuid: string): Promise<string> {
    return join(await appConfigDir(), CACHE_DIRNAME, `${uuid}.mp3`)
}

async function ensureCacheDir(): Promise<void> {
    const dir = await cacheDir()
    if (!(await exists(dir))) await mkdir(dir)
}

/**
 * Downloads and stores the descrambled MP3 for a liked sample in the local
 * liked-cache directory. Safe to call multiple times — exits early if already cached.
 */
export async function saveLikedSampleLocally(sampleAsset: SampleAsset): Promise<void> {
    const path = await cachedFilePath(sampleAsset.uuid)
    if (await exists(path)) return
    await ensureCacheDir()
    const response = await fetch(sampleAsset.files[0].url)
    const raw = new Uint8Array(await response.arrayBuffer())
    const descrambled = descrambleSample(raw)
    await writeFile(path, descrambled)
    console.info("💾 Locally cached liked sample:", sampleAsset.uuid)
}

/**
 * Deletes the local cache file for a sample. Called when the sample is removed
 * from all collections so the disk space is reclaimed.
 */
export async function deleteLikedCache(uuid: string): Promise<void> {
    try {
        const path = await cachedFilePath(uuid)
        if (await exists(path)) {
            await remove(path)
            console.info("🗑️ Deleted local cache:", uuid)
        }
    } catch (e) {
        console.warn("⚠️ Failed to delete local cache for", uuid, e)
    }
}

/**
 * Returns a blob URL for a locally cached liked sample, or null if not cached.
 * Used as an offline fallback in getDescrambledSampleURL.
 */
export async function getBlobFromLikedCache(uuid: string): Promise<string | null> {
    try {
        const path = await cachedFilePath(uuid)
        if (!(await exists(path))) return null
        const data = await readFile(path)
        const blob = new Blob([data], { type: "audio/mp3" })
        return window.URL.createObjectURL(blob)
    } catch (e) {
        console.warn("⚠️ Failed to read liked cache for", uuid, e)
        return null
    }
}
