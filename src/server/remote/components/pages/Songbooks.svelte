<script lang="ts">
    import { onMount } from "svelte"
    import { translate } from "../../util/helpers"
    import { dictionary, openedSongbook, songbooks, activeSongBookSong, songbookShowTransliterated, _set } from "../../util/stores"
    import VirtualList from "../tablet/layout/drawer/VirtualList.svelte"
    import Icon from "../../../common/components/Icon.svelte"
    import Button from "../../../common/components/Button.svelte"
    import { send } from "../../util/socket"

    export let searchValue: string = ""
    export let tablet = false

    $: currentBookId = $openedSongbook
    $: currentBook = currentBookId && $songbooks[currentBookId] ? $songbooks[currentBookId] : null
    $: songs = currentBook ? [...currentBook.songs].sort((a: any, b: any) => {
        const numA = parseFloat(a.Song_No) || 0
        const numB = parseFloat(b.Song_No) || 0
        return numA - numB
    }) : []

    $: hasTransliterated = songs.some(s => s.Transliterated_Title)
    $: bookLanguages = (() => {
        const rawLang = currentBook?.language || currentBook?.Language
        if (!rawLang) return "Original"
        
        let langs: string[] = Array.isArray(rawLang) 
            ? rawLang.map((l: any) => String(l)) 
            : String(rawLang).split(/[,/]/)
            
        langs = langs.map((l: any) => l.trim()).filter((l: any) => l && l.toLowerCase() !== 'english')
        return langs.length ? langs.join(", ") : "Original"
    })()

    function getDisplayTitle(song: any) {
        if ($songbookShowTransliterated && song.Transliterated_Title) {
            return song.Transliterated_Title
        }
        return song.Title || ""
    }

    $: filteredSongbooks = searchValue && !currentBook 
        ? Object.keys($songbooks).filter(key => $songbooks[key].name.toLowerCase().includes(searchValue.toLowerCase()))
        : Object.keys($songbooks)

    $: filteredSongs = (searchValue || $songbookShowTransliterated)
        ? songs.filter(s => {
            const numStr = String(s.Song_No || "")
            const displayTitle = getDisplayTitle(s)
            const searchLower = searchValue.toLowerCase()
            return numStr.toLowerCase().includes(searchLower) ||
                   displayTitle.toLowerCase().includes(searchLower) ||
                   (s.Title || "").toLowerCase().includes(searchLower) ||
                   (s.Transliterated_Title || "").toLowerCase().includes(searchLower)
        })
        : songs

    function playSong(song: any) {
        const showTrans = !!song.Transliterated_Title
        console.log("[REMOTE] playSong clicked:", song.Song_No, song.Title, "showTrans:", showTrans)
        send("START_SONG", { song, showTransliteration: showTrans })
        activeSongBookSong.set({ song, showTransliteration: showTrans })
    }

    onMount(() => {
        // Initially request songbooks in case store is empty
        send("GET_SONGBOOKS", null)
    })
</script>

<div class="songbooks-container">
    <div class="top-bar">
        <div class="mobile-header">
            {#if currentBook}
                <button class="icon-btn" on:click={() => openedSongbook.set("")}>
                    <Icon id="back" size={1.2} />
                </button>
            {/if}
            {#if !tablet || !currentBook}
                <input type="text" class="song-search-input" bind:value={searchValue} placeholder={translate("songbooks.search", $dictionary)} />
            {/if}
        </div>
    </div>

    {#if !currentBook}
        {#if filteredSongbooks.length > 0}
            <div class="list-container">
                {#each filteredSongbooks as key}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <div class="song-item" on:click={() => {
                        openedSongbook.set(key)
                        localStorage.setItem("songbook", key)
                    }}>
                        <div class="song-info">
                            <Icon id="songbooks" size={1.2} />
                            <div class="song-title">{$songbooks[key].name}</div>
                        </div>
                    </div>
                {/each}
            </div>
        {:else}
            <div class="empty-state">
                {translate(searchValue ? "empty.search" : "songbooks.no_book_selected", $dictionary)}
            </div>
        {/if}
    {:else if filteredSongs.length === 0}
        <div class="empty-state">
            {translate("songbooks.no_songs", $dictionary)}
        </div>
    {:else}
        <div class="list-container">
            <VirtualList items={filteredSongs} let:item>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="song-item { $activeSongBookSong?.song?.Title === item.Title && $activeSongBookSong?.song?.Song_No === item.Song_No ? 'active' : '' }" on:click={() => playSong(item)}>
                    <div class="song-info">
                        <div class="song-number">{item.Song_No}</div>
                        <div class="song-title">{getDisplayTitle(item)}</div>
                    </div>
                </div>
            </VirtualList>
        </div>
    {/if}

    {#if currentBook && hasTransliterated}
        <div class="floating-controls-container">
            <Button on:click={() => songbookShowTransliterated.set(!$songbookShowTransliterated)} center dark class="floating-control-button">
                <span class="language-toggle-label">{$songbookShowTransliterated ? "Transliterated" : bookLanguages}</span>
            </Button>
        </div>
    {/if}
</div>

<style>
    .songbooks-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background-color: var(--grey-4);
        position: relative;
    }
    .top-bar {
        padding: 10px;
    }
    .empty-state {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        color: var(--greyText);
        font-size: 1.2em;
    }
    .list-container {
        flex: 1;
        overflow-y: auto;
        position: relative;
        -webkit-overflow-scrolling: touch;
    }
    .song-item {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid var(--grey-3);
        cursor: pointer;
        user-select: none;
    }
    .song-item:hover {
        background-color: var(--grey-3);
    }
    .song-item.active {
        background-color: var(--active);
        color: white;
    }
    .song-info {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
    }
    .song-number {
        font-weight: bold;
        min-width: 40px;
        color: var(--active);
    }
    .song-item.active .song-number {
        color: white;
    }
    .song-title {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .song-search-input {
        flex: 1;
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid var(--grey-3);
        background-color: var(--primary-lighter);
        color: white;
        outline: none;
        font-size: 1rem;
    }
    .mobile-header {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
    }
    .icon-btn {
        background: transparent;
        border: none;
        color: white;
        padding: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
    }
    .icon-btn:hover {
        background: var(--grey-3);
    }

    /* Floating controls matching Scripture tab style */
    .floating-controls-container {
        --size: 44px;
        --padding: 16px;
        --background: rgba(25, 25, 35, 0.85);

        display: flex;
        align-items: center;
        height: var(--size);
        background-color: var(--background);
        border: 1px solid var(--primary-lighter);
        box-shadow: 1px 1px 8px rgb(0 0 0 / 0.5);
        border-radius: var(--size);
        backdrop-filter: blur(4px);
        overflow: hidden;
        z-index: 10;

        position: absolute;
        bottom: var(--padding);
        right: var(--padding);
    }

    :global(.floating-control-button) {
        background-color: transparent !important;
        height: var(--size) !important;
        padding: 0 14px !important;
        border-radius: 0 !important;
        border: none !important;
        box-shadow: none !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
    }

    :global(.floating-control-button:hover) {
        background: rgb(255 255 255 / 0.1) !important;
    }

    :global(.floating-control-button:active) {
        background: rgb(255 255 255 / 0.15) !important;
    }

    .language-toggle-label {
        font-size: 0.9em;
        font-weight: bold;
        text-transform: capitalize;
    }
</style>
