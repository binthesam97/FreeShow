<script lang="ts">
    import type { Item, Line } from "../../../../types/Show"
    import { clone } from "../../helpers/array"

    export let nextItems: Item[] = []
    export let ratio: number = 1
    export let mirror = false

    // Extract the first line from the first text item of the next slide
    $: previewLine = getPreviewLine(nextItems)

    function getPreviewLine(items: Item[]): Line | null {
        if (!items?.length) return null

        // Find the first text item
        const textItem = items.find((item) => (item?.type || "text") === "text" && item?.lines?.length)
        if (!textItem?.lines?.length) return null

        return clone(textItem.lines[0])
    }

    // Build display text from the line
    $: displayText = previewLine?.text?.map((t) => t.value).join("") || ""
    // Get text style from the first text segment
    $: textStyle = previewLine?.text?.[0]?.style || ""
</script>

{#if displayText && !mirror}
    <div class="next-verse-preview" style="zoom: {1 / ratio};">
        <p class="preview-text" style={textStyle}>
            {displayText}
        </p>
    </div>
{/if}

<style>
    .next-verse-preview {
        position: absolute;
        bottom: 3%;
        left: 0;
        width: 100%;
        text-align: center;
        pointer-events: none;
        opacity: 0.35;
        z-index: 1;
    }

    .preview-text {
        margin: 0;
        padding: 0 5%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
