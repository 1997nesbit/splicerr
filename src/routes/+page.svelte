<script lang="ts">
    import SampleListEntry from "./sample-list-entry.svelte"
    import PackDetailDialog from "$lib/components/pack-detail-dialog.svelte"
    import SearchInput from "$lib/components/search-input.svelte"
    import { ScrollArea } from "$lib/components/ui/scroll-area"
    import { onMount, tick } from "svelte"
    import SortSelect from "$lib/components/sort-select.svelte"
    import Search from "lucide-svelte/icons/search"
    import Smile from "lucide-svelte/icons/smile"
    import Ghost from "lucide-svelte/icons/ghost"
    import Library from "lucide-svelte/icons/library"
    import Shuffle from "lucide-svelte/icons/shuffle"
    import Headphones from "lucide-svelte/icons/headphones"
    import Heart from "lucide-svelte/icons/heart"
    import WifiOff from "lucide-svelte/icons/wifi-off"
    import Button from "$lib/components/ui/button/button.svelte"
    // Button still used for shuffle + error retry
    import ProgressLoading from "$lib/components/progress-loading.svelte"
    import Separator from "$lib/components/ui/separator/separator.svelte"
    import SortHeader from "$lib/components/sort-header.svelte"
    import ChevronDown from "lucide-svelte/icons/chevron-down"
    import { cn } from "$lib/utils"
    import AssetCategorySelect from "$lib/components/asset-category-select.svelte"
    import BpmSelect from "$lib/components/bpm-select.svelte"
    import AudioPlayer from "$lib/components/audio-player.svelte"
    import TagBadge from "$lib/components/tag-badge.svelte"
    import { globalAudio } from "$lib/shared/audio.svelte"
    import type { AssetSortType, SampleAsset } from "$lib/splice/types"
    import { loading } from "$lib/shared/loading.svelte"
    import {
        dataStore,
        storeCallbacks,
        queryStore,
        fetchAssets,
        DEFAULT_SORT,
        randomSeed,
    } from "$lib/shared/store.svelte"
    import KeySelect from "$lib/components/key-select.svelte"
    import CollectionsSidebar from "$lib/components/collections-sidebar.svelte"
    import { viewStore, toggleCollectionTag } from "$lib/shared/view.svelte"
    import {
        collectionSamples,
        collectionsStore,
        findCollection,
        removeSample,
        isLiked,
        LIKES_UUID,
    } from "$lib/shared/collections.svelte"
    import { isPreviewed } from "$lib/shared/previewed.svelte"
    import { network } from "$lib/shared/network.svelte"

    // Single source of truth for the active view. The header, list, empty state
    // and row actions all key off this one derived, so they can never disagree
    // mid-switch (which used to flash "Empty collection" over Browse). Falls back
    // to browse if the active collection was deleted.
    const view = $derived.by(() => {
        if (viewStore.mode === "collection" && viewStore.collectionUuid) {
            const collection = findCollection(viewStore.collectionUuid)
            if (collection) return { kind: "collection" as const, collection }
        }
        return { kind: "browse" as const }
    })

    const activeCollection = $derived(
        view.kind === "collection" ? view.collection : null
    )

    // Client-side filter applied to collection and offline browse samples.
    function applyClientFilters(samples: SampleAsset[]): SampleAsset[] {
        let out = samples
        const q = queryStore.query.trim().toLowerCase()
        if (q) {
            out = out.filter(
                (s) =>
                    s.name.toLowerCase().includes(q) ||
                    (s.parents?.items[0]?.name?.toLowerCase() ?? "").includes(q) ||
                    s.tags?.some((t) => t.label.toLowerCase().includes(q))
            )
        }
        if (queryStore.asset_category_slug)
            out = out.filter((s) => s.asset_category_slug === queryStore.asset_category_slug)
        if (queryStore.key) {
            out = out.filter((s) => s.key === queryStore.key)
            if (queryStore.chord_type)
                out = out.filter((s) => s.chord_type === queryStore.chord_type)
        }
        if (queryStore.min_bpm != null)
            out = out.filter((s) => s.bpm != null && s.bpm >= queryStore.min_bpm!)
        if (queryStore.max_bpm != null)
            out = out.filter((s) => s.bpm != null && s.bpm <= queryStore.max_bpm!)
        return out
    }

    function applyClientSort(samples: SampleAsset[]): SampleAsset[] {
        const asc = queryStore.order === "ASC"
        switch (queryStore.sort) {
            case "name":
                return [...samples].sort((a, b) => {
                    const n = (a.name.split("/").pop() ?? "").localeCompare(
                        b.name.split("/").pop() ?? ""
                    )
                    return asc ? n : -n
                })
            case "duration":
                return [...samples].sort((a, b) =>
                    asc ? a.duration - b.duration : b.duration - a.duration
                )
            case "key":
                return [...samples].sort((a, b) => {
                    const n = (a.key ?? "").localeCompare(b.key ?? "")
                    return asc ? n : -n
                })
            case "bpm":
                return [...samples].sort((a, b) =>
                    asc ? (a.bpm ?? 0) - (b.bpm ?? 0) : (b.bpm ?? 0) - (a.bpm ?? 0)
                )
            case "listened":
                return [...samples].sort(
                    (a, b) => (isPreviewed(b.uuid) ? 1 : 0) - (isPreviewed(a.uuid) ? 1 : 0)
                )
            default:
                return samples
        }
    }

    // Triggers an API fetch only when online and in browse mode; in collection mode
    // and offline, shownSamples re-derives reactively from the updated queryStore.
    const onFilterChange = () => {
        if (view.kind === "browse" && network.online) fetchAssets()
    }

    // The samples shown in the main list: search results in browse mode,
    // the collection's stored samples (filtered + sorted) in collection mode.
    const shownSamples = $derived.by(() => {
        if (view.kind !== "collection") {
            // Offline: aggregate all collection samples, deduplicated, with client-side filters
            if (!network.online) {
                const seen = new Set<string>()
                const all: SampleAsset[] = []
                for (const col of collectionsStore.collections) {
                    for (const s of collectionSamples(col.uuid)) {
                        if (!seen.has(s.uuid)) {
                            seen.add(s.uuid)
                            all.push(s)
                        }
                    }
                }
                let samples = applyClientFilters(all)
                samples = applyClientSort(samples)
                if (hideListened) samples = samples.filter((s) => !isPreviewed(s.uuid))
                if (hideLiked) samples = samples.filter((s) => !isLiked(s.uuid))
                return samples
            }
            // Online: normal API-backed browse
            let samples = dataStore.sampleAssets
            if (queryStore.sort === "listened") {
                samples = [...samples].sort(
                    (a, b) => (isPreviewed(b.uuid) ? 1 : 0) - (isPreviewed(a.uuid) ? 1 : 0)
                )
            }
            if (hideListened) samples = samples.filter((s) => !isPreviewed(s.uuid))
            if (hideLiked) samples = samples.filter((s) => !isLiked(s.uuid))
            return samples
        }
        // Collection mode: full client-side filtering + tag filter + sorting
        let samples = collectionSamples(view.collection.uuid)
        samples = applyClientFilters(samples)
        if (viewStore.tagFilter.length > 0) {
            samples = samples.filter((sample) =>
                viewStore.tagFilter.every((tagUuid) =>
                    sample.tags.some((tag) => tag.uuid == tagUuid)
                )
            )
        }
        return applyClientSort(samples)
    })

    // Aggregated tag counts across the open collection's samples, most common first.
    const collectionTagSummary = $derived.by(() => {
        if (view.kind !== "collection") return []
        const counts = new Map<
            string,
            { uuid: string; label: string; count: number }
        >()
        for (const sample of collectionSamples(view.collection.uuid)) {
            for (const tag of sample.tags) {
                const entry = counts.get(tag.uuid) ?? {
                    uuid: tag.uuid,
                    label: tag.label,
                    count: 0,
                }
                entry.count++
                counts.set(tag.uuid, entry)
            }
        }
        return [...counts.values()].sort((a, b) => b.count - a.count)
    })

    // Which empty-state to show, derived from the same source as the list so the
    // message can never disagree with what's actually rendered.
    const emptyStateKind = $derived.by(() => {
        if (shownSamples.length > 0) return null
        if (view.kind === "collection") {
            const anyFilter =
                viewStore.tagFilter.length > 0 ||
                !!queryStore.query.trim() ||
                !!queryStore.key ||
                !!queryStore.asset_category_slug ||
                queryStore.min_bpm != null ||
                queryStore.max_bpm != null
            return anyFilter ? "no-tag-match" : "empty-collection"
        }
        if (!network.online) return "offline-empty"
        if (loading.fetchError) return "error"
        if (loading.beforeFirstLoad) return "welcome"
        return "no-results"
    })

    $effect(() => {
        if (
            queryStore.sort in ["random", "popularity", "relevance", "recency"]
        ) {
            queryStore.order = "DESC"
        }
    })

    storeCallbacks.onbeforedataupdate = () => {
        // The tag drawer/viewport only exist in browse mode; a fetch can resolve
        // while a collection is open, so bail out if they're not mounted.
        viewportRef?.scrollTo({ top: 0, behavior: "smooth" })
    }

    storeCallbacks.onbeforetagsupdate = () => {
        if (!tagsDrawerRef || !tagsContainerRef) return
        tagsDrawerRef.style.height = `${tagsContainerRef.offsetHeight}px`
    }

    let expandTags = $state(false)
    let hideListened = $state(false)
    let hideLiked = $state(false)

    let viewportRef = $state<HTMLElement>(null!)
    let tagsContainerRef = $state<HTMLElement>(null!)
    let tagsDrawerRef = $state<HTMLElement>(null!)
    let searchInputRef = $state<HTMLInputElement>(null!)

    const selectedSampleIndex = $derived(
        shownSamples.findIndex(
            (sampleAsset) => sampleAsset.uuid == globalAudio.currentAsset?.uuid
        )
    )

    const updateSort = (newSort: AssetSortType) => {
        if (queryStore.sort == newSort) {
            if (queryStore.order == "DESC") {
                queryStore.order = "ASC"
            } else {
                queryStore.sort = DEFAULT_SORT
            }
        } else {
            queryStore.sort = newSort
            queryStore.order = "DESC"
        }
        // Only hit the API in online browse; collection mode re-derives via applyClientSort.
        if (view.kind === "browse" && network.online) fetchAssets()
    }

    const gotoPrev = () => {
        const currentIndex = shownSamples.findIndex(
            (asset) => asset.uuid === globalAudio.currentAsset?.uuid
        )
        if (currentIndex > 0) {
            const sampleAsset = shownSamples[currentIndex - 1]
            globalAudio.playSampleAsset(sampleAsset)
            const entryEl = document.getElementById(
                `sample-list-entry-${sampleAsset.uuid}`
            )
            if (entryEl)
                entryEl.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
    }

    const gotoNext = () => {
        const currentIndex = shownSamples.findIndex(
            (asset) => asset.uuid === globalAudio.currentAsset?.uuid
        )
        if (currentIndex !== -1 && currentIndex + 1 < shownSamples.length) {
            const sampleAsset = shownSamples[currentIndex + 1]
            globalAudio.playSampleAsset(sampleAsset)
            const entryEl = document.getElementById(
                `sample-list-entry-${sampleAsset.uuid}`
            )
            if (entryEl)
                entryEl.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
    }

    onMount(() => {
        viewportRef.addEventListener("scroll", () => {
            const distanceFromBottom =
                viewportRef.scrollHeight -
                viewportRef.scrollTop -
                viewportRef.clientHeight

            if (distanceFromBottom >= 300) return
            if (loading.assets || viewStore.mode !== "browse") return
            if (dataStore.sampleAssets.length >= dataStore.total_records) return
            queryStore.page += 1
            console.log("📃 End of list reached, loading more assets")
            fetchAssets()
        })

        searchInputRef.focus()

        // Start with random samples on first open
        queryStore.sort = "random"
        queryStore.random_seed = randomSeed()
        fetchAssets()
    })
</script>

<div class="flex flex-col size-full">
    <div class="flex flex-grow min-h-0">
        <CollectionsSidebar />
        <main class="flex flex-col flex-grow min-w-0">
    <div class="flex flex-col p-4 gap-4">
        <div class="flex gap-4 justify-between items-center">
            {#if view.kind === "browse"}
                <SearchInput
                    bind:value={queryStore.query}
                    onsubmit={onFilterChange}
                    class="flex-grow"
                    bind:inputRef={searchInputRef}
                />
            {:else}
                <h2 class="flex-shrink-0 text-xl font-bold truncate max-w-[12rem]">
                    {activeCollection?.name ?? "Collection"}
                </h2>
                <SearchInput
                    bind:value={queryStore.query}
                    onsubmit={() => {}}
                    class="flex-grow"
                />
            {/if}
            <KeySelect
                bind:key={queryStore.key}
                bind:chord_type={queryStore.chord_type}
                onselect={onFilterChange}
            />
            <BpmSelect
                bind:bpm={queryStore.bpm}
                bind:min_bpm={queryStore.min_bpm}
                bind:max_bpm={queryStore.max_bpm}
                onsubmit={onFilterChange}
            />
            <AssetCategorySelect
                bind:asset_category_slug={queryStore.asset_category_slug}
                onselect={onFilterChange}
            />
        </div>

        {#if view.kind === "browse"}
        <div
            class="transition-[height] ease-in-out overflow-clip"
            bind:this={tagsDrawerRef}
        >
            <div
                class="flex justify-between gap-2"
                bind:this={tagsContainerRef}
            >
                <div
                    class={cn(
                        "min-w-0 relative",
                        !expandTags &&
                            "pr-4 after:content-[''] after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-gradient-to-r after:from-transparent after:to-background after:pointer-events-none"
                    )}
                >
                    <div
                        class={cn(
                            "flex text-nowrap gap-1 overflow-clip flex-shrink",
                            expandTags && "flex-wrap"
                        )}
                    >
                        {#each dataStore.tag_summary as tag}
                            {@const active = dataStore.tags.includes(
                                tag.tag.uuid
                            )}
                            <TagBadge
                                label={tag.tag.label}
                                count={tag.count}
                                {active}
                                onclick={() => {
                                    if (active) {
                                        dataStore.tags.splice(
                                            dataStore.tags.indexOf(
                                                tag.tag.uuid
                                            ),
                                            1
                                        )
                                    } else {
                                        dataStore.tags.push(tag.tag.uuid)
                                    }
                                    fetchAssets()
                                }}
                            />
                        {/each}
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="icon"
                    onclick={() => {
                        expandTags = !expandTags
                        tick().then(() => {
                            tagsDrawerRef.style.height =
                                tagsContainerRef.offsetHeight + "px"
                        })
                    }}
                    class="shrink-0 h-6 px-5 text-muted-foreground"
                >
                    <ChevronDown
                        size="18"
                        class={cn(
                            "transition-transform ease-in-out",
                            expandTags ? "rotate-[-180deg]" : ""
                        )}
                    /></Button
                >
            </div>
        </div>

        <div class="flex justify-between items-end gap-2">
            <div class="text-muted-foreground text-xs flex-grow">
                {#if !network.online}
                    {shownSamples.length} offline sample{shownSamples.length === 1 ? "" : "s"}
                {:else if hideListened || hideLiked}
                    {shownSamples.length.toLocaleString()} of {dataStore.total_records.toLocaleString()} results
                {:else}
                    {dataStore.total_records.toLocaleString()} results
                {/if}
            </div>
            <Button
                variant={hideListened ? "secondary" : "outline"}
                size="icon"
                title={hideListened ? "Showing unheard only (click to show all)" : "Hide listened samples"}
                onclick={() => hideListened = !hideListened}
            >
                <Headphones size="16" />
            </Button>
            <Button
                variant={hideLiked ? "secondary" : "outline"}
                size="icon"
                title={hideLiked ? "Showing uncollected only (click to show all)" : "Hide saved samples"}
                onclick={() => hideLiked = !hideLiked}
            >
                <Heart size="16" />
            </Button>
            <Button
                variant="outline"
                size="icon"
                onclick={() => {
                    queryStore.random_seed = randomSeed()
                    queryStore.sort = "random"
                    fetchAssets()
                }}
            >
                <Shuffle />
            </Button>
            <SortSelect
                bind:sort={queryStore.sort}
                onselect={fetchAssets}
                order={queryStore.order}
            />
        </div>
        {:else}
        <div class="flex flex-col gap-2">
            {#if collectionTagSummary.length > 0}
                <div class="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {#each collectionTagSummary as tag (tag.uuid)}
                        {@const active = viewStore.tagFilter.includes(tag.uuid)}
                        <TagBadge
                            label={tag.label}
                            count={tag.count}
                            {active}
                            onclick={() => toggleCollectionTag(tag.uuid)}
                        />
                    {/each}
                </div>
            {/if}
            <div class="flex items-center gap-2">
                <div class="text-muted-foreground text-xs flex-grow">
                    {shownSamples.length.toLocaleString()} sounds
                </div>
                <Button
                    variant={hideListened ? "secondary" : "outline"}
                    size="icon"
                    title={hideListened ? "Showing unheard only (click to show all)" : "Hide listened samples"}
                    onclick={() => hideListened = !hideListened}
                >
                    <Headphones size="16" />
                </Button>
                <Button
                    variant={hideLiked ? "secondary" : "outline"}
                    size="icon"
                    title={hideLiked ? "Showing uncollected only (click to show all)" : "Hide saved samples"}
                    onclick={() => hideLiked = !hideLiked}
                >
                    <Heart size="16" />
                </Button>
                <SortSelect
                    bind:sort={queryStore.sort}
                    onselect={() => {}}
                    order={queryStore.order}
                />
            </div>
        </div>
        {/if}

        <div class="flex flex-col gap-2">
            <Separator />
            <div
                class="flex gap-2 items-center justify-between overflow-clip px-2"
            >
                <div class="w-12 flex-shrink-0 text-xs text-muted-foreground">
                    Pack
                </div>
                <div
                    class="w-12 flex-shrink-0 text-xs text-muted-foreground"
                ></div>
                <SortHeader
                    value="name"
                    label="Filename"
                    sort={queryStore.sort}
                    order={queryStore.order}
                    onsort={updateSort}
                    class="min-w-32 w-96 flex-[3_1_auto]"
                />
                <div class="min-w-32 w-[150px] flex-grow md:block hidden"></div>
                <SortHeader
                    value="duration"
                    label="Time"
                    sort={queryStore.sort}
                    order={queryStore.order}
                    onsort={updateSort}
                    class="flex-shrink-0 w-14 flex-grow"
                />
                <SortHeader
                    value="key"
                    label="Key"
                    sort={queryStore.sort}
                    order={queryStore.order}
                    onsort={updateSort}
                    class="flex-shrink-0 w-14 flex-grow"
                />
                <SortHeader
                    value="bpm"
                    label="BPM"
                    sort={queryStore.sort}
                    order={queryStore.order}
                    onsort={updateSort}
                    class="flex-shrink-0 w-14 flex-grow"
                />
            </div>
            <ProgressLoading
                loading={loading.assets || loading.waveformsCount > 0}
            />
        </div>
    </div>
    <ScrollArea
        class="px-4 flex-grow before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-4 before:bg-gradient-to-t before:from-transparent before:to-background before:pointer-events-none after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:h-4 after:bg-gradient-to-b after:from-transparent after:to-background after:pointer-events-none"
        bind:viewportRef
        onkeydown={(e) => {
            switch (e.key) {
                case "ArrowUp":
                    e.preventDefault()
                    gotoPrev()
                    break
                case "ArrowDown":
                    e.preventDefault()
                    gotoNext()
                    break
                case "ArrowLeft":
                    e.preventDefault()
                    gotoPrev()
                    break
                case "ArrowRight":
                    e.preventDefault()
                    gotoNext()
                    break
                case " ":
                    e.preventDefault()
                    globalAudio.togglePlay()
                    break
            }
        }}
    >
        <div class="flex flex-col py-2 size-full">
            {#each shownSamples as sampleAsset, index (sampleAsset.uuid)}
                    {@const selected =
                        globalAudio.currentAsset?.uuid == sampleAsset.uuid}
                    <SampleListEntry
                        {sampleAsset}
                        {selected}
                        playing={selected && !globalAudio.paused}
                        collectionUuid={view.kind === "collection"
                            ? view.collection.uuid
                            : null}
                        onremove={() => {
                            if (view.kind === "collection")
                                removeSample(
                                    view.collection.uuid,
                                    sampleAsset.uuid
                                )
                        }}
                    />
                    {#if index < shownSamples.length - 1}
                        <div
                            class={selected || index + 1 == selectedSampleIndex
                                ? "px-2"
                                : ""}
                        >
                            <Separator />
                        </div>
                    {/if}
                {:else}
                    <div
                        class="flex flex-col gap-2 justify-center items-center size-full text-muted-foreground"
                    >
                        {#if emptyStateKind === "no-tag-match"}
                            <Search size="48" />
                            <p class="font-bold text-xl">No matches</p>
                            <p class="text-sm">No sounds match the selected tags.</p>
                        {:else if emptyStateKind === "empty-collection"}
                            <Library size="48" />
                            <p class="font-bold text-xl">Empty collection</p>
                            <p class="text-sm">
                                Add sounds from Browse using the menu on each row.
                            </p>
                        {:else if emptyStateKind === "offline-empty"}
                            <WifiOff size="48" class="text-amber-500" />
                            <p class="font-bold text-xl">You're offline</p>
                            <p class="text-sm">
                                {queryStore.query.trim()
                                    ? "No saved samples match your search."
                                    : "Save samples while online to play them here."}
                            </p>
                        {:else if emptyStateKind === "error"}
                            <Ghost size="48" />
                            <p class="font-bold text-xl">Something went wrong :/</p>
                            <p class="text-sm">Couldn't load any samples</p>
                            <Button onclick={fetchAssets}>Retry</Button>
                        {:else if emptyStateKind === "welcome"}
                            <Smile size="48" />
                            <p class="font-bold text-xl">Hey there!</p>
                            <p class="text-sm">Make some cool music, will ya?</p>
                        {:else}
                            <Search size="48" />
                            <p class="font-bold text-xl">No results</p>
                            <p class="text-sm">Try different keywords</p>
                        {/if}
                    </div>
                {/each}
                {#if view.kind === "browse" && loading.fetchError && dataStore.sampleAssets.length > 0}
                    <div
                        class="flex flex-col py-8 gap-2 justify-center items-center text-muted-foreground"
                    >
                        <Ghost size="48" />
                        <p class="font-bold text-xl">Something went wrong :/</p>
                        <p class="text-sm">Couldn't load any more samples</p>
                        <Button onclick={fetchAssets}>Retry</Button>
                    </div>
                {/if}
        </div>
    </ScrollArea>
        </main>
    </div>
    <AudioPlayer onprev={gotoPrev} onnext={gotoNext} />
</div>
<PackDetailDialog />
