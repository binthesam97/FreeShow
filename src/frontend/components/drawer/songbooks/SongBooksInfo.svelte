<script lang="ts">
    import { activeEdit, activePage, activeSongBookSong, activeStyle, outputs, styles, templates } from "../../../stores"
    import { fitSongbookSlides } from "./songbookFitter"
    import { normalizeLyrics } from "./songbooks"
    import { clone } from "../../helpers/array"
    import { updateStore } from "../../helpers/historyStores"
    import { getFirstActiveOutput } from "../../helpers/output"
    import T from "../../helpers/T.svelte"
    import InputRow from "../../input/InputRow.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import MaterialPopupButton from "../../inputs/MaterialPopupButton.svelte"
    import Media from "../../output/layers/Media.svelte"
    import Textbox from "../../slide/Textbox.svelte"
    import Zoomed from "../../slide/Zoomed.svelte"
    import Center from "../../system/Center.svelte"

    $: songData = $activeSongBookSong
    $: song = songData?.song || null

    $: originalVerses = song ? normalizeLyrics(song.Lyrics?.original) : []
    $: transliterationVerses = song ? normalizeLyrics(song.Lyrics?.transliteration) : []
    $: hasTransliteration = transliterationVerses.length > 0 && !!songData?.showTransliteration

    $: activeOutput = getFirstActiveOutput($outputs)
    $: fallbackStyleId = $activeStyle || ($styles.default ? "default" : Object.keys($styles)[0] || "")
    $: styleId = activeOutput?.style || fallbackStyleId
    $: outputStyle = $styles[styleId] || { name: "" }

    $: templateKey = hasTransliteration ? "templateSongbook_2" : "templateSongbook"
    $: resolvedTemplateId = hasTransliteration ? outputStyle.templateSongbook_2 || outputStyle.templateSongbook || "songbook_2" : outputStyle.templateSongbook || "songbook"
    $: templateId = $templates[resolvedTemplateId] ? resolvedTemplateId : hasTransliteration ? "songbook_2" : "songbook"
    $: template = $templates[templateId] || {}
    $: templateBackground = template.settings?.backgroundPath
    $: background = template.settings?.backgroundColor || outputStyle?.background || "#000000"

    let previewItems = []
    let previewLabel = ""

    $: if (song && originalVerses.length && templateId && styleId) {
        const fitResult = fitSongbookSlides(originalVerses, transliterationVerses, hasTransliteration, {
            songBookName: song.Song_Book || "",
            songNumber: song.Song_No
        })
        previewItems = fitResult.slides[0]?.items || []
        previewLabel = fitResult.slides[0]?.label || ""
    } else {
        previewItems = []
        previewLabel = ""
    }

    function updateSongbookTemplate(value: string | null) {
        const currentStyleId = styleId || "default"
        const nextStyle = clone($styles[currentStyleId] || outputStyle || { name: "" })
        nextStyle[templateKey] = value || ""
        updateStore("styles", currentStyleId, nextStyle)
    }

    function editTemplate() {
        if (!templateId) return

        activeEdit.set({ type: "template", id: templateId, items: [] })
        activePage.set("edit")
    }
</script>

<div class="scroll">
    {#if song}
        <Zoomed style="width: 100%;" {background}>
            {#if templateBackground}
                <Media path={templateBackground} videoData={{ paused: false, muted: true, loop: true }} mirror />
            {/if}

            {#key `${templateId}-${previewLabel}-${previewItems.length}`}
                {#each previewItems as item}
                    <Textbox {item} {outputStyle} ref={{ id: "songbook_info" }} />
                {/each}
            {/key}

            {#if previewLabel}
                <p class="preview-label">{previewLabel}</p>
            {/if}
        </Zoomed>

        <div class="settings border">
            <InputRow>
                <MaterialPopupButton
                    id="songbook"
                    label="info.template"
                    value={templateId}
                    name={template?.name}
                    popupId="select_template"
                    icon="templates"
                    on:change={(e) => updateSongbookTemplate(e.detail)}
                    allowEmpty
                />

                {#if templateId && template}
                    <MaterialButton title="titlebar.edit" icon="edit" on:click={editTemplate} />
                {/if}
            </InputRow>

            <p class="template-details">
                {#if outputStyle?.name}
                    Using style <b>{outputStyle.name}</b>.
                {/if}
                {#if hasTransliteration}
                    This preview is using the transliteration songbook layout.
                {:else}
                    This preview is using the single-language songbook layout.
                {/if}
            </p>

            <div class="info">
                <h2>{song.Song_No}. {song.Title}</h2>

                {#if song.Transliterated_Title}
                    <p class="transliterated-title">{song.Transliterated_Title}</p>
                {/if}

                <div class="meta-list">
                    {#if song.Author}
                        <div class="meta-item">
                            <span class="meta-label"><T id="songbooks.author" /></span>
                            <span class="meta-value">{song.Author}</span>
                        </div>
                    {/if}

                    {#if song.Song_Book}
                        <div class="meta-item">
                            <span class="meta-label">Song Book</span>
                            <span class="meta-value">{song.Song_Book}</span>
                        </div>
                    {/if}

                    {#if song.Language}
                        <div class="meta-item">
                            <span class="meta-label"><T id="songbooks.language" /></span>
                            <span class="meta-value">{song.Language}</span>
                        </div>
                    {/if}

                    {#if song.Scale}
                        <div class="meta-item">
                            <span class="meta-label"><T id="songbooks.scale" /></span>
                            <span class="meta-value">{song.Scale}</span>
                        </div>
                    {/if}

                    {#if song.Meter}
                        <div class="meta-item">
                            <span class="meta-label"><T id="songbooks.meter" /></span>
                            <span class="meta-value">{song.Meter}</span>
                        </div>
                    {/if}

                    {#if song.SID}
                        <div class="meta-item">
                            <span class="meta-label">ID</span>
                            <span class="meta-value">{song.SID}</span>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    {:else}
        <Center faded>
            <T id="songbooks.no_song_selected" />
        </Center>
    {/if}
</div>

<style>
    .scroll {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
    }

    div.scroll :global(.zoomed) {
        height: initial !important;
    }

    .settings {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        flex: 1;
    }

    .preview-label {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        padding: 6px 10px;
        border-radius: 999px;
        background: rgb(0 0 0 / 45%);
        color: white;
        font-size: 0.72rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    .template-details {
        margin: 0;
        color: var(--text);
        opacity: 0.72;
        font-size: 0.85em;
        line-height: 1.45;
        white-space: normal;
    }

    .info h2 {
        font-size: 1em;
        margin: 0 0 5px 0;
    }

    .transliterated-title {
        color: var(--text);
        opacity: 0.6;
        font-size: 0.85em;
        font-style: italic;
        margin: 0 0 12px 0;
    }

    .meta-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
    }

    .meta-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .meta-label {
        font-size: 0.75em;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.5;
        color: var(--text);
    }

    .meta-value {
        color: var(--text);
        font-size: 0.9em;
    }
</style>
