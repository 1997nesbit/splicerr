<script lang="ts">
    import { globalAudio } from "$lib/shared/audio.svelte"
    import PackPreview from "$lib/components/pack-preview.svelte"
    import type { PresetAsset } from "$lib/splice/types"
    import Pause from "lucide-svelte/icons/pause"
    import Play from "lucide-svelte/icons/play"
    import Button from "$lib/components/ui/button/button.svelte"
    import LoaderCircle from "lucide-svelte/icons/loader-circle"
    import { loading } from "$lib/shared/loading.svelte"
    import { cn } from "$lib/utils"
    import Heart from "lucide-svelte/icons/heart"
    import { toggleLike, isLiked } from "$lib/shared/collections.svelte"
    import { getPresetPreviewURL, downloadPresetFxp, openPackDetail } from "$lib/shared/store.svelte"
    import Download from "lucide-svelte/icons/download"
    import Layers from "lucide-svelte/icons/layers"

    let {
        class: className,
        preset,
        selected,
        playing,
    }: {
        class?: string
        preset: PresetAsset
        selected: boolean
        playing: boolean
    } = $props()

    const pack = $derived(preset.parents.items[0])
    const liked = $derived(isLiked(preset.uuid))
    const deviceName = $derived(preset.asset_devices?.[0]?.device?.name ?? "—")
    const minVersion = $derived(preset.asset_devices?.[0]?.device?.minimum_device_version)

    const playPreset = async () => {
        if (loading.samples.has(preset.uuid)) return
        const url = await getPresetPreviewURL(preset)
        if (!url) return
        globalAudio.playPresetFromUrl(preset.uuid, preset.name, url)
    }
</script>

<button
    class={cn(
        "flex gap-4 items-center justify-between p-1 rounded-lg focus:outline-none",
        selected && "bg-muted",
        className
    )}
    id={`preset-list-entry-${preset.uuid}`}
    tabindex="-1"
>
    <PackPreview {pack} />
    <Button
        variant="ghost"
        size="icon"
        class="size-8 text-muted-foreground flex-shrink-0 -ml-2"
        title="Browse pack"
        onclick={(e) => { e.stopPropagation(); if (pack) openPackDetail(pack) }}
    >
        <Layers size="14" />
    </Button>
    <Button
        variant="ghost"
        class="group flex-shrink-0 focus:outline-none"
        size="icon-lg"
        onclick={() => (playing ? globalAudio.ref.pause() : playPreset())}
    >
        {#if (selected && globalAudio.loading) || (loading.samplesCount > 0 && loading.samples.has(preset.uuid))}
            <LoaderCircle class="animate-spin" />
        {:else if playing}
            <Pause />
        {:else}
            <Play class="group-hover:block hidden" />
            <span class="group-hover:hidden text-xs text-muted-foreground font-mono">
                {deviceName.slice(0, 2).toUpperCase()}
            </span>
        {/if}
    </Button>
    <div class="min-w-32 w-96 flex-[3_1_auto] overflow-clip text-left">
        <div class="truncate text-sm">{preset.name}</div>
        <div class="text-xs text-muted-foreground truncate">{deviceName}</div>
    </div>
    <div class="text-muted-foreground flex-shrink-0 w-24 text-xs">
        {minVersion ? `v${minVersion}+` : ""}
    </div>
    <div class="flex-shrink-0 flex items-center gap-0.5">
        <Button
            variant="ghost"
            size="icon"
            class={cn("size-8", liked ? "text-foreground" : "text-muted-foreground")}
            title={liked ? "Remove like" : "Like"}
            onclick={() => toggleLike(preset as unknown as any)}
        >
            <Heart size="16" fill={liked ? "currentColor" : "none"} />
        </Button>
        <Button
            variant="ghost"
            size="icon"
            class="size-8 text-muted-foreground"
            title="Download .fxp (requires Serum Sounds subscription)"
            onclick={() => downloadPresetFxp(preset)}
        >
            <Download size="16" />
        </Button>
    </div>
</button>
