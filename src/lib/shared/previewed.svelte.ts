const STORAGE_KEY = "splicerr:previewed"

function load(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return new Set(raw ? JSON.parse(raw) : [])
    } catch {
        return new Set<string>()
    }
}

function persist(set: Set<string>) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
    } catch {}
}

export const previewedStore = $state({ uuids: load() })

export function markPreviewed(uuid: string) {
    if (previewedStore.uuids.has(uuid)) return
    previewedStore.uuids.add(uuid)
    persist(previewedStore.uuids)
}

export function isPreviewed(uuid: string): boolean {
    return previewedStore.uuids.has(uuid)
}
