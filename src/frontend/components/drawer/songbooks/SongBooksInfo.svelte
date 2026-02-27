<script lang="ts">
    import { activeSongBookSong } from "../../../stores"
    import T from "../../helpers/T.svelte"
    import Center from "../../system/Center.svelte"

    $: song = $activeSongBookSong?.song || null
</script>

<div class="scroll">
    {#if song}
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
        padding: 10px;
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
