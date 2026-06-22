import { zipSync, type Zippable } from "fflate"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { findCollection, refreshCollectionUrls, collectionSamples } from "./collections.svelte"
import { encodeSampleWav } from "./files.svelte"

const sanitizeFileName = (name: string) =>
    name.replace(/[^a-zA-Z0-9#_\-. ]/g, "_").trim() || "collection"

export const exportState = $state({
    busy: new Set<string>(),
})

export async function exportCollectionToZip(
    colUuid: string
): Promise<string | null> {
    const collection = findCollection(colUuid)
    if (!collection) return null

    const samples = collectionSamples(colUuid)
    if (samples.length === 0) {
        throw new Error("Collection is empty")
    }

    const targetPath = await save({
        defaultPath: `${sanitizeFileName(collection.name)}.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
    })
    if (!targetPath) return null

    exportState.busy.add(colUuid)
    try {
        await refreshCollectionUrls(colUuid)

        const entries: Zippable = {}
        for (const sample of samples) {
            try {
                const wav = await encodeSampleWav(sample, 0)
                const base = sample.name.split("/").pop() || "sample"
                let name = sanitizeFileName(base).replace(/\.[^.]*$/, "") + ".wav"
                let i = 1
                while (name in entries) {
                    name = name.replace(/\.wav$/, ` (${i++}).wav`)
                }
                entries[name] = wav
            } catch (e) {
                console.error("⚠️ Skipping sample in export:", sample.name, e)
            }
        }

        if (Object.keys(entries).length === 0) {
            throw new Error("Could not decode any samples")
        }

        const zipped = zipSync(entries, { level: 0 })
        await writeFile(targetPath, zipped)
        console.log("📦 Exported collection to", targetPath)
        return targetPath
    } finally {
        exportState.busy.delete(colUuid)
    }
}
