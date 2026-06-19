export type ToastVariant = "default" | "success" | "error" | "destructive"

export type ToastProgress = {
    received: number
    total: number
    unit: "bytes" | "files"
}

export type Toast = {
    id: string
    title: string
    description?: string
    variant: ToastVariant
    onClick?: () => void
    progress?: ToastProgress | null
}

export const toasts = $state<Toast[]>([])

export function dismissToast(id: string) {
    const index = toasts.findIndex((t) => t.id == id)
    if (index != -1) toasts.splice(index, 1)
}

/**
 * Shows a transient toast in the bottom-right stack. Auto-dismisses after
 * `duration` ms (0 to keep it until dismissed). Returns the toast id.
 */
export function toast(
    opts: {
        title: string
        description?: string
        variant?: ToastVariant
        duration?: number
        onClick?: () => void
    }
): string {
    const id = crypto.randomUUID()
    toasts.push({
        id,
        title: opts.title,
        description: opts.description,
        variant: opts.variant ?? "default",
        onClick: opts.onClick,
    })
    const duration = opts.duration ?? 6000
    if (duration > 0) {
        setTimeout(() => dismissToast(id), duration)
    }
    return id
}

/** Creates a toast with an active progress bar. Call updateToastProgress / completeToast to update it. */
export function downloadToast(opts: {
    title: string
    total: number
    unit?: "bytes" | "files"
}): string {
    const id = crypto.randomUUID()
    toasts.push({
        id,
        title: opts.title,
        variant: "default",
        progress: { received: 0, total: opts.total, unit: opts.unit ?? "bytes" },
    })
    return id
}

/** Updates the progress on an active download toast. */
export function updateToastProgress(id: string, received: number, total?: number): void {
    const t = toasts.find((t) => t.id === id)
    if (!t?.progress) return
    t.progress.received = received
    if (total !== undefined) t.progress.total = total
}

/** Transitions a download toast to its final state (success/error) and schedules auto-dismiss. */
export function completeToast(
    id: string,
    opts: {
        title: string
        description?: string
        variant?: ToastVariant
        onClick?: () => void
        duration?: number
    }
): void {
    const t = toasts.find((t) => t.id === id)
    if (!t) return
    t.progress = null
    t.title = opts.title
    t.description = opts.description
    t.variant = opts.variant ?? "success"
    t.onClick = opts.onClick
    const duration = opts.duration ?? 8000
    if (duration > 0) setTimeout(() => dismissToast(id), duration)
}
