<script lang="ts">
    import { onMount } from "svelte"
    import { activeSongBookSong, outLocked, songBooks, templates, songbookShowTransliterated } from "../../../stores"
    import { setDefaultSongbookTemplates } from "../../../utils/createData"
    import { createSongSearchEntry, createSongShow, loadSongBooks, normalizeLyrics, playSong, searchSongbookSongs, sortSongsByNumber } from "./songbooks"
    import type { SongSearchEntry, SongVerse } from "./songbooks"
    import Icon from "../../helpers/Icon.svelte"
    import T from "../../helpers/T.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import Center from "../../system/Center.svelte"
    import Loader from "../../main/Loader.svelte"
    import FloatingInputs from "../../input/FloatingInputs.svelte"

    export let active: string | null
    export let searchValue: string

    let selectedSongIndex: number = -1
    let lyricsScrollElem: HTMLElement | undefined

    // Load songbooks if not loaded
    onMount(async () => {
        // Ensure default songbook templates exist - they may be absent for existing users
        // who had their data saved before the songbook templates were added to the codebase.
        // getDeletedTemplates() at startup incorrectly marks them as "deleted" since they
        // were missing at that time. setDefaultSongbookTemplates() clears that and adds them.
        if (!$templates["songbook"] || !$templates["songbook_2"]) {
            setDefaultSongbookTemplates()
        }

        if (!Object.keys($songBooks).length) {
            const books = await loadSongBooks()
            songBooks.set(books)
        }
    })

    $: currentBook = active ? $songBooks[active] : null
    $: songs = currentBook?.songs || []

    $: searchableSongs = songs.map((song): SongSearchEntry => createSongSearchEntry(song))
    $: filteredSongs = (searchValue || $songbookShowTransliterated) ? (searchValue ? searchSongbookSongs(searchableSongs, searchValue) : [...songs].sort(sortSongsByNumber)) : (searchValue ? searchSongbookSongs(searchableSongs, searchValue) : [...songs].sort(sortSongsByNumber))

    $: selectedSong = selectedSongIndex >= 0 && selectedSongIndex < filteredSongs.length ? filteredSongs[selectedSongIndex] : null

    // Update active song store when selection changes
    $: if (selectedSong) {
        activeSongBookSong.set({ song: selectedSong, showTransliteration: hasTransliteration })
    }

    // Reset selection when switching books
    $: if (active) {
        selectedSongIndex = -1
        activeSongBookSong.set(null)
    }

    function selectSong(index: number) {
        selectedSongIndex = index
        if (lyricsScrollElem) lyricsScrollElem.scrollTop = 0
    }

    $: originalVerses = selectedSong ? normalizeLyrics(selectedSong.Lyrics?.original) : []
    $: transliterationVerses = selectedSong ? normalizeLyrics(selectedSong.Lyrics?.transliteration) : []
    $: hasTransliteration = transliterationVerses.length > 0

    $: sortedOriginalVerses = [...originalVerses].sort((a, b) => a.order - b.order)
    $: sortedTransliterationVerses = [...transliterationVerses].sort((a, b) => a.order - b.order)

    function getVerseLabel(verse: SongVerse): string {
        const type = verse.type?.toLowerCase() || "verse"
        if (type === "chorus") return "Chorus"
        if (type === "bridge") return "Bridge"
        const num = verse.displayNumber || verse.order
        return `Verse ${num}`
    }

    function getDisplayTitle(song: any) {
        if ($songbookShowTransliterated && song.Transliterated_Title) {
            return song.Transliterated_Title
        }
        return song.Title || ""
    }

    $: hasTransliteratedAny = songs.some(s => s.Transliterated_Title)
    $: bookLanguages = (() => {
        const rawLang = currentBook?.language || currentBook?.Language
        if (!rawLang) return "Original"
        
        let langs: string[] = Array.isArray(rawLang) 
            ? rawLang.map(l => String(l)) 
            : String(rawLang).split(/[,/]/)
            
        langs = langs.map(l => l.trim()).filter(l => l && l.toLowerCase() !== 'english')
        return langs.length ? langs.join(", ") : "Original"
    })()

    function handlePlay() {
        playSong()
    }

    function handleCreateShow() {
        createSongShow()
    }
</script>

<div class="main">
    {#if !active}
        <Center faded>
            <T id="songbooks.no_book_selected" />
        </Center>
    {:else if !currentBook}
        <Center>
            <Loader />
        </Center>
    {:else}
        <div class="content-area">
            <!-- Song list -->
            <div class="song-list">
                {#if filteredSongs.length}
                    {#each filteredSongs as song, i}
                        <button
                            class="song-item"
                            class:isActive={selectedSongIndex === i}
                            on:click={() => selectSong(i)}
                            on:dblclick={handlePlay}
                        >
                            <span class="song-number">{song.Song_No}</span>
                            <span class="song-title">{getDisplayTitle(song)}</span>
                        </button>
                    {/each}
                {:else}
                    <Center faded>
                        <T id="songbooks.no_songs" />
                    </Center>
                {/if}
            </div>

            <!-- Lyrics display -->
            <div class="lyrics-panel" bind:this={lyricsScrollElem}>
                {#if selectedSong}
                    <div class="lyrics-header">
                        <h3>{selectedSong.Song_No}. {getDisplayTitle(selectedSong)}</h3>
                        {#if selectedSong.Author}
                            <p class="author">{selectedSong.Author}</p>
                        {/if}
                    </div>

                    {#if hasTransliteration}
                        <div class="lyrics-columns">
                            <div class="lyrics-column">
                                <div class="column-header">Original</div>
                                <div class="lyrics-body">
                                    {#each sortedOriginalVerses as verse}
                                        <div class="verse-block" class:chorus={verse.type === "chorus"}>
                                            <span class="verse-label">{getVerseLabel(verse)}</span>
                                            <pre class="verse-content">{verse.content}</pre>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                            <div class="lyrics-column">
                                <div class="column-header">Transliteration</div>
                                <div class="lyrics-body">
                                    {#each sortedTransliterationVerses as verse}
                                        <div class="verse-block" class:chorus={verse.type === "chorus"}>
                                            <span class="verse-label">{getVerseLabel(verse)}</span>
                                            <pre class="verse-content">{verse.content}</pre>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    {:else}
                        <div class="lyrics-body">
                            {#each sortedOriginalVerses as verse}
                                <div class="verse-block" class:chorus={verse.type === "chorus"}>
                                    <span class="verse-label">{getVerseLabel(verse)}</span>
                                    <pre class="verse-content">{verse.content}</pre>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {:else}
                    <Center faded>
                        <T id="songbooks.no_song_selected" />
                    </Center>
                {/if}
            </div>
        </div>
    {/if}
</div>

{#if active && hasTransliteratedAny}
    <FloatingInputs side="left">
        <MaterialButton on:click={() => songbookShowTransliterated.set(!$songbookShowTransliterated)} title={$songbookShowTransliterated ? "songbooks.show_original" : "songbooks.show_transliterated"}>
            <Icon id="refresh" white size={0.9} />
            <span class="language-toggle-label">{$songbookShowTransliterated ? "Transliterated" : bookLanguages}</span>
        </MaterialButton>
    </FloatingInputs>
{/if}

{#if selectedSong}
    <FloatingInputs>
        <MaterialButton disabled={$outLocked} title="songbooks.play_song" on:click={handlePlay}>
            <Icon size={1.3} id="play" white />
        </MaterialButton>

        <div class="divider" />

        <MaterialButton title="songbooks.convert_to_show" on:click={handleCreateShow}>
            <Icon size={1.1} id="slide" white />
            <T id="songbooks.convert_to_show" />
        </MaterialButton>
    </FloatingInputs>
{/if}

<style>
    .main {
        position: relative;
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
    }

    .content-area {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    /* Song list */
    .song-list {
        width: 280px;
        min-width: 200px;
        overflow-y: auto;
        border-inline-end: 2px solid var(--primary-lighter);
        padding-bottom: 60px;
    }

    .song-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 10px;
        border: none;
        background: none;
        color: var(--text);
        cursor: pointer;
        text-align: start;
        font-size: 0.9em;
    }

    .song-item:hover:not(.isActive) {
        background-color: var(--hover);
    }

    .song-item.isActive {
        background-color: var(--focus);
    }

    .song-number {
        color: var(--secondary);
        font-weight: bold;
        min-width: 35px;
        text-align: end;
    }

    .song-title {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    /* Lyrics panel */
    .lyrics-panel {
        flex: 1;
        overflow-y: auto;
        padding: 15px;
        padding-bottom: 60px;
    }

    .lyrics-header {
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--primary-lighter);
    }

    .lyrics-header h3 {
        color: var(--text);
        margin: 0;
        font-size: 1.1em;
    }

    .author {
        color: var(--text);
        opacity: 0.6;
        font-size: 0.85em;
        margin: 4px 0 0 0;
    }

    .lyrics-columns {
        display: flex;
        gap: 15px;
        flex: 1;
        min-height: 0;
    }

    .lyrics-column {
        flex: 1;
        min-width: 0;
    }

    .column-header {
        color: var(--secondary);
        font-weight: bold;
        font-size: 0.85em;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--primary-lighter);
    }

    .lyrics-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .verse-block {
        padding: 8px 12px;
        border-radius: 6px;
        background-color: var(--primary-darker);
    }

    .verse-block.chorus {
        border-left: 3px solid var(--secondary);
        background-color: var(--primary-darkest);
    }

    .verse-label {
        display: block;
        color: var(--secondary);
        font-weight: bold;
        font-size: 0.8em;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .verse-content {
        color: var(--text);
        white-space: pre-wrap;
        font-family: inherit;
        font-size: 0.95em;
        line-height: 1.5;
        margin: 0;
    }

    .divider {
        width: 1px;
        height: 20px;
        background-color: var(--primary-lighter);
        margin: 0 4px;
    }

    .language-toggle-label {
        font-size: 0.8em;
        font-weight: bold;
        text-transform: capitalize;
        padding-left: 6px;
        white-space: nowrap;
    }
</style>
