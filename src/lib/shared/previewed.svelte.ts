const STORAGE_KEY = "splicerr:previewed"
const MAX_SIZE = 2000

function load(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return new Set(JSON.parse(raw) as string[])
    } catch {}
    return new Set()
}

function persist(set: Set<string>) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
    } catch {}
}

const _previewed = $state(load())

export function isPreviewed(uuid: string): boolean {
    return _previewed.has(uuid)
}

export function markPreviewed(uuid: string) {
    if (_previewed.has(uuid)) return
    if (_previewed.size >= MAX_SIZE) {
        const oldest = _previewed.values().next().value
        if (oldest !== undefined) _previewed.delete(oldest)
    }
    _previewed.add(uuid)
    persist(_previewed)
}
