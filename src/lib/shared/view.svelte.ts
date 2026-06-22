import { findCollection, type Collection } from "./collections.svelte"

type BrowseView = { kind: "browse"; collection: null; tagFilter: string[] }
type CollectionView = { kind: "collection"; collection: Collection; tagFilter: string[] }
type PacksView = { kind: "packs"; collection: null; tagFilter: string[] }
export type ViewState = BrowseView | CollectionView | PacksView

type MutableView = { kind: "browse" | "collection" | "packs"; collection: Collection | null; tagFilter: string[] }

const _state = $state<ViewState>({ kind: "browse", collection: null, tagFilter: [] })
const _mut = _state as unknown as MutableView

export const view: ViewState = _state
export const viewStore: ViewState = _state

export function openCollection(uuidOrCollection: string | Collection) {
    const col = typeof uuidOrCollection === "string"
        ? findCollection(uuidOrCollection)
        : uuidOrCollection
    if (!col) return
    _mut.kind = "collection"
    _mut.collection = col
    _mut.tagFilter = []
}

export function openPackSearch() {
    _mut.kind = "packs"
    _mut.collection = null
    _mut.tagFilter = []
}

export function openBrowse() {
    _mut.kind = "browse"
    _mut.collection = null
    _mut.tagFilter = []
}

export function toggleCollectionTag(tagUuid: string) {
    const i = _state.tagFilter.indexOf(tagUuid)
    if (i === -1) _state.tagFilter.push(tagUuid)
    else _state.tagFilter.splice(i, 1)
}
