// Lyric scroll: the current lyrics, the next slide (dimmed) and a peek of the one after are stacked
// as one continuous reel. Advancing scrolls the whole reel up, so the dimmed next lyrics move into
// place and brighten instead of the text being swapped.

// opacity of the upcoming slides below the current lyrics (next, then the one after)
export const UPCOMING_OPACITY = [0.5, 0.22]

// space between two slides in the reel, relative to one line of text
const GAP_RATIO = 0.6

// the outgoing reel starts first, the incoming reel reads its motion right after
let outgoingMotion: { distance: number; index: number | null; started: number } | null = null

function getReel(node: HTMLElement) {
    return node.querySelector<HTMLElement>(".lyric-reel.active")
}

function getSlideIndex(reel: HTMLElement) {
    const index = reel.dataset.slideIndex
    return index === undefined || index === "" ? null : Number(index)
}

export function lyricScroll(node: HTMLElement, options: { direction?: "in" | "out" | "both" } = {}) {
    const reel = getReel(node)
    // non lyric items (media, labels) just fade
    if (!reel) return { css: (t: number) => `opacity: ${t};` }

    const offset = Number(reel.dataset.scrollOffset) || 0

    if (options.direction === "out") {
        const motion = { distance: -offset, index: getSlideIndex(reel), started: Date.now() }
        outgoingMotion = motion

        // tick (not css) so the incoming reel can still reverse the direction when going backwards
        return {
            tick: (t: number) => {
                node.style.transform = `translateY(${motion.distance * (1 - t)}px)`
                node.style.opacity = String(t)
            }
        }
    }

    const outgoing = outgoingMotion && Date.now() - outgoingMotion.started < 3000 ? outgoingMotion : null
    outgoingMotion = null

    // nothing to scroll from (first slide)
    if (!outgoing) return { css: (t: number) => `opacity: ${t};` }

    const index = getSlideIndex(reel)
    const backwards = outgoing.index !== null && index !== null && index < outgoing.index

    // going back: the outgoing lyrics move down into the "next" position of this reel
    let start = -outgoing.distance
    if (backwards) {
        outgoing.distance = offset
        start = -offset
    }

    return { css: (t: number) => `transform: translateY(${start * (1 - t)}px); opacity: ${t};` }
}

// positions the upcoming slides of a reel directly below the current lyrics
export function lyricReel(node: HTMLElement, enabled: boolean) {
    let frame = 0
    let active = false

    const resizeObserver = new ResizeObserver(schedule)
    const mutationObserver = new MutationObserver(() => {
        observeLines()
        schedule()
    })

    function schedule() {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(measure)
    }

    function observeLines() {
        resizeObserver.disconnect()
        node.querySelectorAll(".lyric-layer .lines").forEach((elem) => resizeObserver.observe(elem))
    }

    function measure() {
        const layers = Array.from(node.querySelectorAll<HTMLElement>(":scope > .lyric-layer"))
        const reelRect = node.getBoundingClientRect()
        const scale = node.offsetHeight ? reelRect.height / node.offsetHeight : 0
        if (!scale) return

        let previousBottom: number | null = null
        let gap = 0
        let scrollOffset = 0

        layers.forEach((layer, i) => {
            const lines = layer.querySelector<HTMLElement>(".lines")
            if (!lines || (previousBottom === null && i > 0)) return

            const applied = Number(layer.dataset.offset) || 0
            const rect = lines.getBoundingClientRect()
            const top = (rect.top - reelRect.top) / scale - applied
            const height = rect.height / scale

            if (i === 0) {
                const lineCount = Math.max(1, lines.querySelectorAll(":scope > .break:not(.chords)").length)
                gap = (height / lineCount) * GAP_RATIO
                previousBottom = top + height
                scrollOffset = height + gap
                return
            }

            const offset = previousBottom! + gap - top
            layer.dataset.offset = String(offset)
            layer.style.transform = `translateY(${offset}px)`
            if (i === 1) scrollOffset = offset
            previousBottom = top + offset + height
        })

        node.dataset.scrollOffset = String(scrollOffset)
    }

    function start() {
        if (active) return
        active = true
        observeLines()
        mutationObserver.observe(node, { childList: true, subtree: true })
        // measure right away, the outgoing transition reads the offset as soon as the next slide is shown
        measure()
    }

    function stop() {
        if (!active) return
        active = false
        cancelAnimationFrame(frame)
        resizeObserver.disconnect()
        mutationObserver.disconnect()
    }

    if (enabled) start()

    return {
        update(newEnabled: boolean) {
            if (newEnabled) start()
            else stop()
        },
        destroy: stop
    }
}
