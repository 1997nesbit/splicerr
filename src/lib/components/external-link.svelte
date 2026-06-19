<script lang="ts">
    import { cn } from "$lib/utils"
    import { openUrl } from "@tauri-apps/plugin-opener"
    import type { Snippet } from "svelte"

    const {
        to,
        children,
        class: className,
    }: { to: string; children: Snippet<[]>; class?: string } = $props()
</script>

<button class={cn("focus:outline-none", className)} onclick={() => openUrl(to)}>
    {@render children?.()}
</button>
