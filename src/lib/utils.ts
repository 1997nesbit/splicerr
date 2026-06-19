import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { ChordType, Key } from "./splice/types"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const formatKey = (key: Key, chord_type: ChordType | null = null) => {
    return key.toUpperCase() + (chord_type ? ` ${chord_type.substring(0,3)}` : "")
}
