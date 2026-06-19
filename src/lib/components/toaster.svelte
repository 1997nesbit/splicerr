<script lang="ts">
    import { cn } from "$lib/utils"
    import { toasts, dismissToast } from "$lib/shared/toasts.svelte"
    import { fly } from "svelte/transition"
    import { flip } from "svelte/animate"
    import CheckCircle2 from "lucide-svelte/icons/circle-check"
    import CircleAlert from "lucide-svelte/icons/circle-alert"
    import Info from "lucide-svelte/icons/info"
    import Trash2 from "lucide-svelte/icons/trash-2"
    import X from "lucide-svelte/icons/x"
    import LoaderCircle from "lucide-svelte/icons/loader-circle"

    function formatBytes(b: number): string {
        if (b === 0) return "0 B"
        if (b < 1024) return `${b} B`
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
        return `${(b / 1024 / 1024).toFixed(1)} MB`
    }

    const icons = {
        success: CheckCircle2,
        error: CircleAlert,
        destructive: Trash2,
        default: Info,
    }
</script>

<div
    class="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 w-[26rem] max-w-[calc(100vw-3rem)] pointer-events-none"
>
    {#each toasts as t (t.id)}
        {@const Icon = icons[t.variant]}
        {@const isDownloading = t.progress != null}
        {@const pct = t.progress && t.progress.total > 0
            ? Math.round((t.progress.received / t.progress.total) * 100)
            : null}
        <div
            class={cn(
                "pointer-events-auto flex items-start gap-3.5 rounded-xl border border-l-4 bg-background p-4 shadow-xl",
                t.variant === "success" && "border-l-green-500",
                (t.variant === "error" || t.variant === "destructive") &&
                    "border-l-destructive",
                t.variant === "default" && "border-l-muted-foreground"
            )}
            in:fly={{ x: 24, duration: 200 }}
            out:fly={{ x: 24, duration: 150 }}
            animate:flip={{ duration: 200 }}
        >
            {#if isDownloading}
                <LoaderCircle
                    size="24"
                    class="flex-shrink-0 mt-0.5 text-muted-foreground animate-spin"
                />
            {:else}
                <Icon
                    size="24"
                    class={cn(
                        "flex-shrink-0 mt-0.5",
                        t.variant === "success" && "text-green-500",
                        (t.variant === "error" || t.variant === "destructive") &&
                            "text-destructive",
                        t.variant === "default" && "text-muted-foreground"
                    )}
                />
            {/if}
            <div class="min-w-0 flex-grow">
                <p class="text-sm font-semibold truncate" title={t.title}>{t.title}</p>
                {#if t.progress}
                    {@const prog = t.progress}
                    <p class="text-xs text-muted-foreground mt-0.5">
                        {#if prog.unit === "files"}
                            {prog.received} / {prog.total} files
                            {#if pct !== null}&nbsp;· {pct}%{/if}
                        {:else if prog.total > 0}
                            {formatBytes(prog.received)} / {formatBytes(prog.total)}
                            &nbsp;· {pct ?? 0}%
                        {:else if prog.received > 0}
                            {formatBytes(prog.received)}
                        {:else}
                            Starting…
                        {/if}
                    </p>
                    <div class="w-full bg-muted rounded-full h-1 mt-2 overflow-hidden">
                        {#if pct !== null}
                            <div
                                class="bg-primary rounded-full h-1 transition-[width] duration-150 ease-out"
                                style="width: {pct}%"
                            ></div>
                        {:else}
                            <div class="bg-primary rounded-full h-1 w-full animate-pulse"></div>
                        {/if}
                    </div>
                {:else if t.description}
                    {#if t.onClick}
                        <button
                            class="text-sm text-left text-muted-foreground break-all mt-0.5 underline-offset-2 hover:underline hover:text-foreground"
                            onclick={() => t.onClick?.()}
                        >
                            {t.description}
                        </button>
                    {:else}
                        <p class="text-sm text-muted-foreground break-all mt-0.5">
                            {t.description}
                        </p>
                    {/if}
                {/if}
            </div>
            <button
                class="flex-shrink-0 text-muted-foreground hover:text-foreground rounded-sm p-1"
                aria-label="Dismiss"
                onclick={() => dismissToast(t.id)}
            >
                <X size="18" />
            </button>
        </div>
    {/each}
</div>
