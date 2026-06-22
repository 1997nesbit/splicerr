<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog/index.js"
    import { ScrollArea } from "$lib/components/ui/scroll-area"
    import Separator from "$lib/components/ui/separator/separator.svelte"
    import ProgressLoading from "$lib/components/progress-loading.svelte"
    import SampleListEntry from "../../routes/sample-list-entry.svelte"
    import SearchInput from "$lib/components/search-input.svelte"
    import KeySelect from "$lib/components/key-select.svelte"
    import BpmSelect from "$lib/components/bpm-select.svelte"
    import AssetCategorySelect from "$lib/components/asset-category-select.svelte"
    import SortHeader from "$lib/components/sort-header.svelte"
    import Button from "$lib/components/ui/button/button.svelte"
    import { globalAudio } from "$lib/shared/audio.svelte"
    import {
        packDetailStore,
        fetchPackSamples,
        refreshPackSamples,
        downloadAllPackSamples,
    } from "$lib/shared/store.svelte"
    import { isPreviewed } from "$lib/shared/previewed.svelte"
    import type { AssetSortType } from "$lib/splice/types"
    import FolderDown from "lucide-svelte/icons/folder-down"
    import Headphones from "lucide-svelte/icons/headphones"
    import ArrowDownUp from "lucide-svelte/icons/arrow-down-up"
    import FilterX from "lucide-svelte/icons/filter-x"
    import { cn } from "$lib/utils"

    let viewportRef = $state<HTMLElement>(null!)
    let listenedOnly = $state(false)
    let listenedFirst = $state(false)
    // BpmSelect needs a bindable bpm string; pack detail only uses min/max range.
    let packBpm = $state<string | null>(null)

    const selectedIndex = $derived(
        packDetailStore.samples.findIndex(
            (s) => s.uuid === globalAudio.currentAsset?.uuid
        )
    )

    const packName = $derived(packDetailStore.pack?.name.split("/").slice(-1)[0] ?? "")
    const packImg = $derived(packDetailStore.pack?.files[0]?.url)

    const displayedSamples = $derived.by(() => {
        let list = packDetailStore.samples
        if (listenedOnly) list = list.filter((s) => isPreviewed(s.uuid))
        if (listenedFirst) {
            list = [...list].sort(
                (a, b) => (isPreviewed(b.uuid) ? 1 : 0) - (isPreviewed(a.uuid) ? 1 : 0)
            )
        }
        return list
    })

    const hasActiveFilters = $derived(
        !!packDetailStore.query ||
        !!packDetailStore.key ||
        packDetailStore.min_bpm != null ||
        packDetailStore.max_bpm != null ||
        !!packDetailStore.asset_category_slug
    )

    function onFilterChange() {
        refreshPackSamples()
    }

    function updatePackSort(newSort: AssetSortType) {
        if (packDetailStore.sort === newSort) {
            if (packDetailStore.order === "DESC") {
                packDetailStore.order = "ASC"
            } else {
                packDetailStore.sort = "popularity"
                packDetailStore.order = "DESC"
            }
        } else {
            packDetailStore.sort = newSort
            packDetailStore.order = "DESC"
        }
        refreshPackSamples()
    }

    function clearFilters() {
        packDetailStore.query = ""
        packDetailStore.key = null
        packDetailStore.chord_type = null
        packDetailStore.min_bpm = null
        packDetailStore.max_bpm = null
        packDetailStore.asset_category_slug = null
        refreshPackSamples()
    }

    $effect(() => {
        const el = viewportRef
        if (!el) return
        function onscroll() {
            if (packDetailStore.downloading) return
            if (packDetailStore.loading) return
            if (packDetailStore.samples.length >= packDetailStore.total_records) return
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight
            if (dist >= 300) return
            packDetailStore.page += 1
            fetchPackSamples()
        }
        el.addEventListener("scroll", onscroll)
        return () => el.removeEventListener("scroll", onscroll)
    })
</script>

<Dialog.Root bind:open={packDetailStore.open}>
    <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
            class="max-w-4xl w-full h-[85vh] flex flex-col gap-0 p-0 overflow-hidden"
        >
            <!-- Header -->
            <div class="flex items-center gap-4 p-4 pb-3 border-b flex-shrink-0">
                {#if packImg}
                    <img
                        src={packImg}
                        alt={packName}
                        class="size-14 rounded-lg object-cover flex-shrink-0 shadow-sm"
                        draggable="false"
                    />
                {/if}
                <div class="min-w-0 flex-grow">
                    <h2 class="text-base font-bold truncate leading-tight">{packName}</h2>
                    {#if packDetailStore.total_records > 0}
                        <p class="text-xs text-muted-foreground mt-0.5">
                            {#if hasActiveFilters}
                                {packDetailStore.total_records.toLocaleString()} matching · {packDetailStore.samples.length.toLocaleString()} loaded
                            {:else}
                                {packDetailStore.total_records.toLocaleString()} samples
                            {/if}
                        </p>
                    {/if}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    class="flex-shrink-0 gap-2"
                    disabled={packDetailStore.downloading || packDetailStore.loading || packDetailStore.total_records === 0}
                    onclick={downloadAllPackSamples}
                >
                    <FolderDown size="15" />
                    {#if packDetailStore.downloadProgress}
                        {packDetailStore.downloadProgress.done} / {packDetailStore.downloadProgress.total}
                    {:else}
                        Download all
                    {/if}
                </Button>
            </div>

            <!-- Search + filter bar -->
            <div class="flex items-center gap-2 px-4 py-2 border-b flex-shrink-0">
                <SearchInput
                    bind:value={packDetailStore.query}
                    onsubmit={onFilterChange}
                    class="flex-grow"
                />
                <KeySelect
                    bind:key={packDetailStore.key}
                    bind:chord_type={packDetailStore.chord_type}
                    onselect={onFilterChange}
                />
                <BpmSelect
                    bind:bpm={packBpm}
                    bind:min_bpm={packDetailStore.min_bpm}
                    bind:max_bpm={packDetailStore.max_bpm}
                    onsubmit={onFilterChange}
                />
                <AssetCategorySelect
                    bind:asset_category_slug={packDetailStore.asset_category_slug}
                    onselect={onFilterChange}
                />
                {#if hasActiveFilters}
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Clear all filters"
                        onclick={clearFilters}
                        class="flex-shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <FilterX size="16" />
                    </Button>
                {/if}
            </div>

            <!-- Secondary toolbar -->
            <div class="flex items-center gap-2 px-4 py-1.5 border-b flex-shrink-0">
                <Button
                    variant={listenedOnly ? "secondary" : "ghost"}
                    size="sm"
                    class="h-7 gap-1.5 text-xs"
                    onclick={() => listenedOnly = !listenedOnly}
                >
                    <Headphones size="13" />
                    Listened only
                </Button>
                <Button
                    variant={listenedFirst ? "secondary" : "ghost"}
                    size="sm"
                    class="h-7 gap-1.5 text-xs"
                    onclick={() => listenedFirst = !listenedFirst}
                >
                    <ArrowDownUp size="13" />
                    Listened first
                </Button>
                {#if listenedOnly}
                    <span class="text-xs text-muted-foreground ml-auto">
                        {displayedSamples.length} shown
                    </span>
                {/if}
            </div>

            <!-- Column headers -->
            <div class="flex gap-4 items-center px-5 py-1 flex-shrink-0 text-xs text-muted-foreground">
                <div class="w-12 flex-shrink-0">Pack</div>
                <div class="w-12 flex-shrink-0"></div>
                <SortHeader
                    value="name"
                    label="Filename"
                    sort={packDetailStore.sort}
                    order={packDetailStore.order}
                    onsort={updatePackSort}
                    class="min-w-32 w-96 flex-[3_1_auto]"
                />
                <div class="min-w-32 w-[150px] flex-grow hidden md:block"></div>
                <SortHeader
                    value="duration"
                    label="Time"
                    sort={packDetailStore.sort}
                    order={packDetailStore.order}
                    onsort={updatePackSort}
                    class="flex-shrink-0 w-14 flex-grow"
                />
                <SortHeader
                    value="key"
                    label="Key"
                    sort={packDetailStore.sort}
                    order={packDetailStore.order}
                    onsort={updatePackSort}
                    class="flex-shrink-0 w-14 flex-grow"
                />
                <SortHeader
                    value="bpm"
                    label="BPM"
                    sort={packDetailStore.sort}
                    order={packDetailStore.order}
                    onsort={updatePackSort}
                    class="flex-shrink-0 w-14 flex-grow"
                />
                <div class="flex-shrink-0 w-8"></div>
            </div>
            <ProgressLoading loading={packDetailStore.loading || packDetailStore.downloading} />
            <Separator />

            <!-- Sample list -->
            <ScrollArea class="flex-grow px-4" bind:viewportRef>
                <div class="flex flex-col py-2">
                    {#each displayedSamples as sample, i (sample.uuid)}
                        {@const selected = globalAudio.currentAsset?.uuid === sample.uuid}
                        <SampleListEntry
                            sampleAsset={sample}
                            {selected}
                            playing={selected && !globalAudio.paused}
                            hidePackButton={true}
                        />
                        {#if i < displayedSamples.length - 1}
                            <div class={cn(selected || i + 1 === selectedIndex ? "px-2" : "")}>
                                <Separator />
                            </div>
                        {/if}
                    {:else}
                        {#if !packDetailStore.loading}
                            <div class="flex flex-col gap-2 justify-center items-center py-16 text-muted-foreground">
                                {#if listenedOnly}
                                    <Headphones size="36" />
                                    <p class="text-sm">No listened samples in this pack yet.</p>
                                {:else if hasActiveFilters}
                                    <FilterX size="36" />
                                    <p class="text-sm">No samples match your filters.</p>
                                    <Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
                                {:else}
                                    <p class="text-sm">No samples found.</p>
                                {/if}
                            </div>
                        {/if}
                    {/each}
                </div>
            </ScrollArea>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
