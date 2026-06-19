import { querySplice, SamplesSearch, PresetsSearch, AssetFilesByUuids } from "$lib/splice/api"
import { descrambleSample } from "$lib/splice/descrambler"
import type {
    AssetCategorySlug,
    AssetSortType,
    ChordType,
    Key,
    PackAsset,
    PresetAsset,
    PresetsSearchResponse,
    SampleAsset,
    SamplesSearchResponse,
    SortOrder,
    TagSummaryEntry,
} from "$lib/splice/types"
import { globalAudio } from "./audio.svelte"
import { loading } from "./loading.svelte"
import { config } from "./config.svelte"
import { fetch } from "@tauri-apps/plugin-http"
import { save } from "@tauri-apps/plugin-dialog"
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
                    const newItems = searchResult.items.filter(
                        (item) => !dataStore.sampleAssets.some((other) => other.uuid === item.uuid)
                    )
                    dataStore.sampleAssets.push(...newItems)
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

    const response = await fetch(sampleAsset.files[0].url)

    const data = new Uint8Array(await response.arrayBuffer())

    const descrambledData = descrambleSample(data)

    const blob = new Blob([descrambledData], {
        type: "audio/mp3",
    })

    const blobURL = window.URL.createObjectURL(blob)

    dataStore.descrambledSamples.set(sampleAsset.uuid, blobURL)

    loading.samples.delete(sampleAsset.uuid)
    loading.samplesCount--

    console.info("🔗 Created descrambled sample blob")

    return blobURL
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

// ─── Preset store ────────────────────────────────────────────────────────────

export const presetStore = $state({
    presetAssets: [] as PresetAsset[],
    previewUrls: new Map<string, string>(),
    fxpUrls: new Map<string, string>(),
    total_records: 0,
    tag_summary: [] as TagSummaryEntry[],
})

export const presetQueryStore = $state({
    query: "",
    sort: "random" as AssetSortType,
    random_seed: randomSeed(),
    order: "DESC" as SortOrder,
    page: 1,
})

let currentPresetQueryIdentity = ""

export const fetchPresets = () => {
    const identity = JSON.stringify({
        query: presetQueryStore.query,
        sort: presetQueryStore.sort,
        order: presetQueryStore.order,
        random_seed: presetQueryStore.random_seed,
    })

    if (identity !== currentPresetQueryIdentity) {
        presetStore.presetAssets = []
        presetStore.total_records = 0
        presetQueryStore.page = 1
    }

    loading.assets = true

    querySplice(PresetsSearch, {
        query: presetQueryStore.query || null,
        sort: presetQueryStore.sort,
        order: presetQueryStore.order,
        random_seed: presetQueryStore.random_seed,
        page: presetQueryStore.page,
        limit: PER_PAGE,
    })
        .then((response) => {
            const result = (response as PresetsSearchResponse).data.assetsSearch
            if (identity === currentPresetQueryIdentity) {
                presetStore.presetAssets.push(...result.items)
            } else {
                presetStore.presetAssets = result.items
                currentPresetQueryIdentity = identity
            }
            presetStore.total_records = result.response_metadata.records
            presetStore.tag_summary = result.tag_summary
            loading.assets = false
            loading.fetchError = null
        })
        .catch((error: Error) => {
            loading.fetchError = error
            loading.assets = false
        })
}

export async function getPresetPreviewURL(preset: PresetAsset): Promise<string | null> {
    const existing = presetStore.previewUrls.get(preset.uuid)
    if (existing) return existing

    const previewFile = preset.files.find(
        (f) =>
            f.asset_file_type_slug === "preview_mp3" ||
            f.asset_file_type_slug === "preview" ||
            f.asset_file_type_slug === "mp3" ||
            f.asset_file_type_slug === "audio-preview"
    )
    if (!previewFile) {
        console.warn("⚠️ No preview file found for preset", preset.name, "— slugs:", preset.files.map((f) => f.asset_file_type_slug))
        return null
    }

    console.info("🎛️ Fetching preset preview", preset.name, previewFile.url)

    loading.samples.add(preset.uuid)
    loading.samplesCount++

    try {
        const response = await fetch(previewFile.url)
        if (!response.ok) {
            console.error("⚠️ Preset preview fetch failed", response.status, previewFile.url)
            return null
        }
        // Preset previews are plain MP3s — no descrambling needed
        const data = new Uint8Array(await response.arrayBuffer())
        const blob = new Blob([data], { type: "audio/mp3" })
        const url = window.URL.createObjectURL(blob)
        presetStore.previewUrls.set(preset.uuid, url)
        console.info("🔗 Preset preview ready", preset.name)
        return url
    } catch (e) {
        console.error("⚠️ Preset preview error", e)
        return null
    } finally {
        loading.samples.delete(preset.uuid)
        loading.samplesCount--
    }
}

export async function getPresetFxpURL(preset: PresetAsset): Promise<string | null> {
    const existing = presetStore.fxpUrls.get(preset.uuid)
    if (existing) return existing

    const fxpFile = preset.files.find(
        (f) => f.asset_file_type_slug === "fxp" || f.path?.endsWith(".fxp")
    )
    if (!fxpFile) {
        console.warn("⚠️ No FXP file found for preset", preset.name, "— available slugs:", preset.files.map((f) => f.asset_file_type_slug))
        return null
    }

    loading.samples.add(preset.uuid)
    loading.samplesCount++

    try {
        const response = await fetch(fxpFile.url)
        const data = new Uint8Array(await response.arrayBuffer())
        const descrambled = descrambleSample(data)
        const blob = new Blob([descrambled], { type: "application/octet-stream" })
        const url = window.URL.createObjectURL(blob)
        presetStore.fxpUrls.set(preset.uuid, url)
        return url
    } finally {
        loading.samples.delete(preset.uuid)
        loading.samplesCount--
    }
}

export async function downloadPresetFxp(preset: PresetAsset): Promise<void> {
    loading.samples.add(preset.uuid)
    loading.samplesCount++

    try {
        // The search API only returns preview_mp3; fetch all files via AssetFilesByUuids
        let fxpUrl: string | null = null

        const inSearch = preset.files.find(
            (f) => f.asset_file_type_slug === "fxp" || f.path?.endsWith(".fxp")
        )
        if (inSearch) {
            fxpUrl = inSearch.url
        } else {
            console.info("🔍 FXP not in search results, fetching via AssetFilesByUuids...")
            const result = await querySplice(AssetFilesByUuids, { assetUuids: [preset.uuid] }) as any
            const entry = result?.data?.assetFiles?.[0]
            if (entry) {
                console.info("📦 AssetFilesByUuids returned", entry.files.map((f: any) => f.asset_file_type_slug + ": " + f.path))
                const fxpFile = entry.files.find(
                    (f: any) => f.asset_file_type_slug === "fxp" || f.path?.endsWith(".fxp")
                )
                if (fxpFile) fxpUrl = fxpFile.url
            }
        }

        if (!fxpUrl) {
            console.warn("⚠️ No FXP file found for", preset.name)
            return
        }

        const response = await fetch(fxpUrl)
        if (!response.ok) {
            console.error("⚠️ FXP fetch failed", response.status, fxpUrl)
            return
        }
        const data = new Uint8Array(await response.arrayBuffer())
        const descrambled = descrambleSample(data)

        const safeName = preset.name.replace(/[<>:"/\\|?*]/g, "_")
        const savePath = await save({
            defaultPath: safeName + ".fxp",
            filters: [{ name: "Serum Preset", extensions: ["fxp"] }],
        })

        if (savePath) {
            await writeFile(savePath, descrambled)
            console.info("💾 Saved", preset.name, "to", savePath)
        }
    } finally {
        loading.samples.delete(preset.uuid)
        loading.samplesCount--
    }
}

export async function saveSampleToDisk(sampleAsset: SampleAsset): Promise<void> {
    if (!config.samples_dir) {
        console.warn("⚠️ No samples directory configured — set it in Settings")
        return
    }

    const filename = sampleAsset.name.split("/").at(-1) ?? sampleAsset.name

    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++

    try {
        let data: Uint8Array
        const cachedUrl = dataStore.descrambledSamples.get(sampleAsset.uuid)
        if (cachedUrl) {
            // Already played — reuse in-memory blob, no re-download needed
            const res = await window.fetch(cachedUrl)
            data = new Uint8Array(await res.arrayBuffer())
        } else {
            // Not yet played — download, descramble, and cache so play is instant too
            const res = await fetch(sampleAsset.files[0].url)
            const raw = new Uint8Array(await res.arrayBuffer())
            data = descrambleSample(raw)
            const blob = new Blob([data.buffer as ArrayBuffer], { type: "audio/mp3" })
            dataStore.descrambledSamples.set(sampleAsset.uuid, window.URL.createObjectURL(blob))
        }

        await writeFile(`${config.samples_dir}/${filename}`, data)
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
})

export function openPackDetail(pack: PackAsset) {
    packDetailStore.pack = pack
    packDetailStore.samples = []
    packDetailStore.total_records = 0
    packDetailStore.page = 1
    packDetailStore.open = true
    fetchPackSamples()
}

export function fetchPackSamples() {
    if (!packDetailStore.pack) return
    packDetailStore.loading = true
    querySplice(SamplesSearch, {
        parent_asset_uuid: packDetailStore.pack.uuid,
        page: packDetailStore.page,
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
        .then((response) => {
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
