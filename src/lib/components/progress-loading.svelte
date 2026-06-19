<script lang="ts">
    import Separator from "$lib/components/ui/separator/separator.svelte"
    import { cn } from "$lib/utils.js"

    let { class: className, loading }: { class?: string; loading: boolean } =
        $props()
</script>

<div class={cn("w-full", className)}>
    <div class="w-full overflow-clip relative">
        <Separator />
        <div
            class={cn(
                "absolute top-0 animate-progress-loading w-full h-full bg-muted-foreground origin-left-right transition-[opacity] [transition-duration:1s]",
                !loading && "opacity-0"
            )}
        ></div>
    </div>
</div>
