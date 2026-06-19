import Settings2 from "lucide-svelte/icons/settings-2"
import DiscAlbum from "lucide-svelte/icons/disc-album"
import AudioLines from "lucide-svelte/icons/audio-lines"
import Repeat from "lucide-svelte/icons/repeat"

export const assetIcons: { [index: string]: any } = {
    oneshot: AudioLines,
    loop: Repeat,
    preset: Settings2,
    pack: DiscAlbum,
}