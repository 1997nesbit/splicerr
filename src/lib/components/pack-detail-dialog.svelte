<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog/index.js"
    import { ScrollArea } from "$lib/components/ui/scroll-area"
    import Separator from "$lib/components/ui/separator/separator.svelte"
    import ProgressLoading from "$lib/components/progress-loading.svelte"
    import SampleListEntry from "../../routes/sample-list-entry.svelte"
    import Button from "$lib/components/ui/button/button.svelte"
    import { globalAudio } from "$lib/shared/audio.svelte"
    import {
        packDetailStore,
        fetchPackSamples,
        downloadAllPackSamples,
    } from "$lib/shared/store.svelte"
    import { isPreviewed } from "$lib/shared/previewed.svelte"
    import FolderDown from "lucide-svelte/icons/folder-down"
    import Headphones from "lucide-svelte/icons/headphones"
    import ArrowDownUp from "lucide-svelte/icons/arrow-down-up"
    import { cn } from "$lib/utils"

    let viewportRef = $state<HTMLElement>(null!)
    let listenedOnly = $state(false)
    let listenedFirst = $state(false)

    const selectedIndex = $derived(
        packDetailStore.samples.findIndex(
            (s) => s.uuid === globalAudio.currentAsset?.uuid
        )
    )

    const packName = $derived(packDetailStore.pack?.name.split("/").slice(-1)[0] ?? "")
    const packImg = $derived(packDetailStore.pack?.files[0]?.url)
    const provider = $derived(packDetailStore.pack?.provider?.name ?? "")

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

    function onscroll() {
        if (!viewportRef) return
        if (packDetailStore.downloading) return
        const dist = viewportRef.scrollHeight - viewportRef.scrollTop - viewportRef.clientHeight
        if (dist >= 300) return
        if (packDetailStore.loading) return
        if (packDetailStore.samples.length >= packDetailStore.total_records) return
        packDetailStore.page += 1
        fetchPackSamples()
    }
</script>

<Dialog.Root bind:open={packDetailStore.open}>
    <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
            class="max-w-4xl w-full h-[80vh] flex flex-col gap-0 p-0 overflow-hidden"
        >
            <!-- Header -->
            <div class="flex items-center gap-4 p-4 border-b flex-shrink-0">
                {#if packImg}
                    <img src={packImg} alt={packName} class="size-16 rounded flex-shrink-0" draggable="false" />
                {/if}
                <div class="min-w-0 flex-grow">
                    <h2 class="text-lg font-bold truncate">{packName}</h2>
                    {#if provider}
                        <p class="text-sm text-muted-foreground">{provider}</p>
                    {/if}
                    {#if packDetailStore.total_records > 0}
                        <p class="text-xs text-muted-foreground">
                            {packDetailStore.total_records.toLocaleString()} samples
                        </p>
                    {/if}
                </div>
                <!-- Download all pack button -->
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

            <!-- Filter / sort toolbar -->
            <div class="flex items-center gap-2 px-4 py-2 border-b flex-shrink-0">
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
                {#if listenedOnly || listenedFirst}
                    <span class="text-xs text-muted-foreground ml-auto">
                        {displayedSamples.length} shown
                    </span>
                {/if}
            </div>

            <!-- Column headers -->
            <div class="flex gap-4 items-center px-5 py-1.5 flex-shrink-0">
                <div class="w-12 flex-shrink-0"></div>
                <div class="w-12 flex-shrink-0"></div>
                <div class="min-w-32 w-96 flex-[3_1_auto] text-xs text-muted-foreground">Filename</div>
                <div class="min-w-32 w-[150px] flex-grow hidden md:block"></div>
                <div class="flex-shrink-0 w-14 text-xs text-muted-foreground">Time</div>
                <div class="flex-shrink-0 w-14 text-xs text-muted-foreground">Key</div>
                <div class="flex-shrink-0 w-14 text-xs text-muted-foreground">BPM</div>
                <div class="flex-shrink-0 w-8"></div>
            </div>
            <ProgressLoading loading={packDetailStore.loading || packDetailStore.downloading} />
            <Separator />

            <!-- Sample list -->
            <ScrollArea
                class="flex-grow px-4"
                bind:viewportRef
                onscroll={onscroll}
            >
                <div class="flex flex-col py-2">
                    {#each displayedSamples as sample, i (sample.uuid)}
                        {@const selected = globalAudio.currentAsset?.uuid === sample.uuid}
                        <SampleListEntry
                            sampleAsset={sample}
                            {selected}
                            playing={selected && !globalAudio.paused}
                        />
                        {#if i < displayedSamples.length - 1}
                            <div class={selected || i + 1 === selectedIndex ? "px-2" : ""}>
                                <Separator />
                            </div>
                        {/if}
                    {:else}
                        {#if !packDetailStore.loading}
                            <div class="flex justify-center items-center py-16 text-muted-foreground text-sm">
                                {listenedOnly ? "No listened samples in this pack yet" : "No samples found"}
                            </div>
                        {/if}
                    {/each}
                </div>
            </ScrollArea>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
