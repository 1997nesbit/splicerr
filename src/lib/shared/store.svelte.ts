import { querySplice, SamplesSearch } from "$lib/splice/api"
import { descrambleSample } from "$lib/splice/descrambler"
import type {
    AssetCategorySlug,
    AssetSortType,
    ChordType,
    Key,
    SampleAsset,
    SamplesSearchResponse,
    SortOrder,
    TagSummaryEntry,
} from "$lib/splice/types"
import { globalAudio } from "./audio.svelte"
import { loading } from "./loading.svelte"
import { fetch } from "@tauri-apps/plugin-http"
import { getBlobFromLikedCache } from "./liked-cache"
import { network } from "./network.svelte"
import { writeFile } from "@tauri-apps/plugin-fs"
import { pitchShiftAudioBuffer, semitonesFor } from "./transpose.svelte"
import { audioBufferToWav, decodeAudioFromURL } from "./wav"

export const DEFAULT_SORT = "relevance"
export const PER_PAGE = 50

export const randomSeed = () =>
    Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString()

export const dataStore = $state({
    sampleAssets: [] as SampleAsset[],
    descrambledSamples: new Map<string, string>(),
    // Pitch-shifted preview blobs, keyed by `${uuid}:${semitones}`
    transposedSamples: new Map<string, string>(),
    tags: [] as string[],
    tag_summary: [] as TagSummaryEntry[],
    total_records: 0,
})

export const keys = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
] as const
export const chord_types = ["major", "minor"]

export const queryStore = $state({
    query: "",
    sort: DEFAULT_SORT as AssetSortType,
    random_seed: randomSeed(),
    order: "DESC" as SortOrder,
    page: 1,
    asset_category_slug: null as AssetCategorySlug | null,
    bpm: null as string | null,
    min_bpm: null as number | null,
    max_bpm: null as number | null,
    key: null as Key | null,
    chord_type: null as ChordType | null,
})

// The query identity is the part of the query that uniquely identifies the returned data
// It is used to determine if the fetched data should replace the current data, be appended to it, or be ignored
const queryIdentity = $derived({
    query: queryStore.query,
    sort: queryStore.sort,
    order: queryStore.order,
    random_seed: queryStore.random_seed,
    tags: dataStore.tags,
    asset_category_slug: queryStore.asset_category_slug,
    bpm: queryStore.bpm?.toString(),
    min_bpm: queryStore.min_bpm,
    max_bpm: queryStore.max_bpm,
    key: queryStore.key,
    chord_type: queryStore.chord_type,
})

export const storeCallbacks = $state({
    onbeforedataupdate: null as (() => void) | null,
    onbeforetagsupdate: null as (() => void) | null,
})

let currentQueryIdentity: string = ""

export const fetchAssets = () => {
    if (!network.online) return
    const identityBeforeFetch = JSON.stringify(queryIdentity)
    if (identityBeforeFetch != currentQueryIdentity) {
        storeCallbacks.onbeforedataupdate?.()
    }
    loading.assets = true
    querySplice(SamplesSearch, {
        ...queryIdentity,
        page: queryStore.page,
        limit: PER_PAGE,
    })
        .then((response) => {
            const searchResult = (response as SamplesSearchResponse).data
                .assetsSearch
            const identityAfterFetch = JSON.stringify(queryIdentity)
            if (identityBeforeFetch == identityAfterFetch) {
                if (identityBeforeFetch == currentQueryIdentity) {
                    dataStore.sampleAssets.push(...searchResult.items)
                    console.info("➕ Loaded more assets")
                } else {
                    // Free descrambled samples that are not in the new search result / currently selected
                    for (const sampleAsset of dataStore.sampleAssets) {
                        if (
                            !searchResult.items.some(
                                (other) => sampleAsset.uuid == other.uuid
                            ) &&
                            sampleAsset.uuid != globalAudio.currentAsset?.uuid
                        ) {
                            freeDescrambledSample(sampleAsset.uuid)
                        }
                    }
                    // Prevent duplicates
                    dataStore.sampleAssets = searchResult.items.filter(
                        (asset) =>
                            !dataStore.sampleAssets.some(
                                (other) => other.uuid == asset.uuid
                            )
                    )
                    currentQueryIdentity = identityAfterFetch
                    queryStore.page = 1
                    console.info("🔄️ Loaded new assets")
                }
                dataStore.total_records = searchResult.response_metadata.records

                storeCallbacks.onbeforetagsupdate?.()
                dataStore.tag_summary = searchResult.tag_summary

                loading.assets = false
                loading.beforeFirstLoad = false

                loading.fetchError = null
            } else {
                console.info("🕜 Ignored stale assets")
            }
        })
        .catch((error: Error) => {
            console.error("⚠️ Failed to fetch assets", error)
            loading.fetchError = error
            loading.assets = false
        })
}

export async function getDescrambledSampleURL(sampleAsset: SampleAsset) {
    const existingBlobURL = dataStore.descrambledSamples.get(sampleAsset.uuid)
    if (existingBlobURL) {
        console.info("✔️ Reusing descrambled sample blob")
        return existingBlobURL
    }

    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++

    try {
        const response = await fetch(sampleAsset.files[0].url)
        const data = new Uint8Array(await response.arrayBuffer())
        const descrambledData = descrambleSample(data)
        const blob = new Blob([descrambledData], { type: "audio/mp3" })
        const blobURL = window.URL.createObjectURL(blob)
        dataStore.descrambledSamples.set(sampleAsset.uuid, blobURL)
        console.info("🔗 Created descrambled sample blob")
        return blobURL
    } catch (networkError) {
        // Offline fallback: play from the local liked-cache if available.
        const cachedUrl = await getBlobFromLikedCache(sampleAsset.uuid)
        if (cachedUrl) {
            dataStore.descrambledSamples.set(sampleAsset.uuid, cachedUrl)
            console.info("📁 Playing liked sample from local cache")
            return cachedUrl
        }
        throw networkError
    } finally {
        loading.samples.delete(sampleAsset.uuid)
        loading.samplesCount--
    }
}

export function freeDescrambledSample(uuid: string) {
    // Free any pitch-shifted variants of this sample first
    for (const key of [...dataStore.transposedSamples.keys()]) {
        if (key.startsWith(`${uuid}:`)) {
            window.URL.revokeObjectURL(dataStore.transposedSamples.get(key)!)
            dataStore.transposedSamples.delete(key)
        }
    }

    const existingBlobURL = dataStore.descrambledSamples.get(uuid)
    if (!existingBlobURL) return false

    dataStore.descrambledSamples.delete(uuid)
    window.URL.revokeObjectURL(existingBlobURL)
    console.info("⛓️‍💥 Freed descrambled sample")

    return true
}

/**
 * Returns a blob URL of the sample pitch-shifted by `semitones`,
 * rendering and caching it on first use.
 */
export async function getTransposedSampleURL(
    sampleAsset: SampleAsset,
    semitones: number
) {
    const cacheKey = `${sampleAsset.uuid}:${semitones}`
    const existing = dataStore.transposedSamples.get(cacheKey)
    if (existing) {
        console.info("✔️ Reusing transposed sample blob")
        return existing
    }

    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++

    try {
        const descrambledURL = await getDescrambledSampleURL(sampleAsset)
        const buffer = await decodeAudioFromURL(descrambledURL)
        const shifted = pitchShiftAudioBuffer(buffer, semitones)
        const wav = audioBufferToWav(shifted)
        const blobURL = window.URL.createObjectURL(
            new Blob([wav], { type: "audio/wav" })
        )
        dataStore.transposedSamples.set(cacheKey, blobURL)
        console.info(`🎚️ Created transposed sample blob (${semitones} st)`)
        return blobURL
    } finally {
        loading.samples.delete(sampleAsset.uuid)
        loading.samplesCount--
    }
}

/** Picks the right playback URL for a sample given the current transpose settings. */
export async function getPlaybackSampleURL(sampleAsset: SampleAsset) {
    const semitones = semitonesFor(sampleAsset)
    if (!semitones) return await getDescrambledSampleURL(sampleAsset)
    return await getTransposedSampleURL(sampleAsset, semitones)
}

/** Drops every cached pitch-shifted blob (e.g. after transpose settings change). */
export function clearTransposedCache() {
    for (const url of dataStore.transposedSamples.values()) {
        window.URL.revokeObjectURL(url)
    }
    dataStore.transposedSamples.clear()
    console.info("🧹 Cleared transposed sample cache")
}

export async function saveSampleToDisk(
    sampleAsset: SampleAsset,
    options?: { silent?: boolean }
): Promise<void> {
    if (!config.samples_dir) {
        console.warn("⚠️ No samples directory configured — set it in Settings")
        return
    }

    const filename = sampleAsset.name.split("/").at(-1) ?? sampleAsset.name
    const fullPath = `${config.samples_dir}/${filename}`

    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++

    try {
        let data: Uint8Array
        const cachedUrl = dataStore.descrambledSamples.get(sampleAsset.uuid)

        if (cachedUrl) {
            // Already played — reuse in-memory blob, no re-download
            const res = await window.fetch(cachedUrl)
            data = new Uint8Array(await res.arrayBuffer())
            await writeFile(fullPath, data)
            if (!options?.silent) {
                toast({ title: filename, description: `Saved to ${fullPath}`, variant: "success" })
            }
        } else {
            // Network download — stream with byte-level progress
            const res = await fetch(sampleAsset.files[0].url)
            const contentLength = Number(res.headers.get("content-length") ?? 0)
            const toastId = options?.silent ? null : downloadToast({ title: filename, total: contentLength })

            let rawData: Uint8Array
            if (res.body) {
                const reader = res.body.getReader()
                const chunks: Uint8Array[] = []
                let received = 0
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    chunks.push(value)
                    received += value.length
                    if (toastId) updateToastProgress(toastId, received, contentLength || received)
                }
                rawData = new Uint8Array(received)
                let offset = 0
                for (const chunk of chunks) { rawData.set(chunk, offset); offset += chunk.length }
            } else {
                rawData = new Uint8Array(await res.arrayBuffer())
                if (toastId) updateToastProgress(toastId, rawData.length, rawData.length)
            }

            data = descrambleSample(rawData)
            const blob = new Blob([data.buffer as ArrayBuffer], { type: "audio/mp3" })
            dataStore.descrambledSamples.set(sampleAsset.uuid, window.URL.createObjectURL(blob))

            await writeFile(fullPath, data)

            if (toastId) {
                completeToast(toastId, {
                    title: filename,
                    description: `Saved to ${fullPath}`,
                    variant: "success",
                })
            }
        }

        console.info("💾 Saved", filename, "to", config.samples_dir)
    } finally {
        loading.samples.delete(sampleAsset.uuid)
        loading.samplesCount--
    }
}

// ─── Pack detail ──────────────────────────────────────────────────────────────

export const packDetailStore = $state({
    open: false,
    pack: null as PackAsset | null,
    samples: [] as SampleAsset[],
    total_records: 0,
    page: 1,
    loading: false,
    downloading: false,
    downloadProgress: null as { done: number; total: number } | null,
    // Search / filter / sort — reset whenever a new pack is opened
    query: "",
    sort: "popularity" as AssetSortType,
    order: "DESC" as SortOrder,
    key: null as Key | null,
    chord_type: null as ChordType | null,
    min_bpm: null as number | null,
    max_bpm: null as number | null,
    asset_category_slug: null as AssetCategorySlug | null,
})

export function openPackDetail(pack: PackAsset) {
    packDetailStore.pack = pack
    packDetailStore.samples = []
    packDetailStore.total_records = 0
    packDetailStore.page = 1
    packDetailStore.query = ""
    packDetailStore.sort = "popularity"
    packDetailStore.order = "DESC"
    packDetailStore.key = null
    packDetailStore.chord_type = null
    packDetailStore.min_bpm = null
    packDetailStore.max_bpm = null
    packDetailStore.asset_category_slug = null
    packDetailStore.open = true
    fetchPackSamples()
}

/** Reset to page 1 and re-fetch after a filter/sort/search change. */
export function refreshPackSamples() {
    packDetailStore.samples = []
    packDetailStore.total_records = 0
    packDetailStore.page = 1
    fetchPackSamples()
}

// Incremented on every refresh so stale in-flight responses are ignored.
let packFetchVersion = 0

export function fetchPackSamples() {
    if (!packDetailStore.pack) return
    packDetailStore.loading = true
    const version = ++packFetchVersion
    querySplice(SamplesSearch, {
        parent_asset_uuid: packDetailStore.pack.uuid,
        page: packDetailStore.page,
        limit: PER_PAGE,
        sort: packDetailStore.sort,
        order: packDetailStore.order,
        random_seed: null,
        query: packDetailStore.query || null,
        tags: [],
        key: packDetailStore.key,
        chord_type: packDetailStore.chord_type,
        bpm: null,
        min_bpm: packDetailStore.min_bpm,
        max_bpm: packDetailStore.max_bpm,
        asset_category_slug: packDetailStore.asset_category_slug,
        ac_uuid: null,
    })
        .then((response) => {
            if (version !== packFetchVersion) return // stale response — discard
            const result = (response as SamplesSearchResponse).data.assetsSearch
            const newItems = result.items.filter(
                (item) => !packDetailStore.samples.some((s) => s.uuid === item.uuid)
            )
            packDetailStore.samples.push(...newItems)
            packDetailStore.total_records = result.response_metadata.records
            packDetailStore.loading = false
        })
        .catch(() => {
            packDetailStore.loading = false
        })
}

export async function downloadAllPackSamples() {
    if (!packDetailStore.pack || !config.samples_dir) return
    packDetailStore.downloading = true

    try {
        // Wait for any in-flight initial fetch to land
        let waited = 0
        while (packDetailStore.loading && waited < 6000) {
            await new Promise<void>((res) => setTimeout(res, 150))
            waited += 150
        }
        if (packDetailStore.total_records === 0) return

        // Fetch all pages not yet loaded
        while (packDetailStore.samples.length < packDetailStore.total_records) {
            if (packDetailStore.loading) {
                await new Promise<void>((res) => setTimeout(res, 150))
                continue
            }
            const nextPage = Math.floor(packDetailStore.samples.length / PER_PAGE) + 1
            packDetailStore.loading = true
            try {
                const response = await querySplice(SamplesSearch, {
                    parent_asset_uuid: packDetailStore.pack.uuid,
                    page: nextPage,
                    limit: PER_PAGE,
                    sort: "popularity",
                    order: "DESC",
                    random_seed: null,
                    query: null,
                    tags: [],
                    key: null,
                    chord_type: null,
                    bpm: null,
                    min_bpm: null,
                    max_bpm: null,
                    asset_category_slug: null,
                    ac_uuid: null,
                })
                const result = (response as SamplesSearchResponse).data.assetsSearch
                const newItems = result.items.filter(
                    (item) => !packDetailStore.samples.some((s) => s.uuid === item.uuid)
                )
                packDetailStore.samples.push(...newItems)
                packDetailStore.total_records = result.response_metadata.records
            } finally {
                packDetailStore.loading = false
            }
        }

        // Download each sample sequentially under a single pack-level progress toast
        const all = [...packDetailStore.samples]
        packDetailStore.downloadProgress = { done: 0, total: all.length }
        const packName = packDetailStore.pack?.name.split("/").at(-1) ?? "Pack"
        const toastId = downloadToast({ title: packName, total: all.length, unit: "files" })

        for (let i = 0; i < all.length; i++) {
            await saveSampleToDisk(all[i], { silent: true })
            packDetailStore.downloadProgress.done = i + 1
            updateToastProgress(toastId, i + 1, all.length)
        }

        completeToast(toastId, {
            title: packName,
            description: `${all.length} samples saved to ${config.samples_dir}`,
            variant: "success",
            duration: 10000,
        })
    } finally {
        packDetailStore.downloading = false
        packDetailStore.downloadProgress = null
    }
}
