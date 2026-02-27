<script lang="ts">
    import { drawerTabsData, songBooks } from "../../../stores"
    import { loadSongBooks } from "../songbooks/songbooks"
    import Icon from "../../helpers/Icon.svelte"
    import T from "../../helpers/T.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import NavigationSections from "./NavigationSections.svelte"

    $: activeSubTab = $drawerTabsData.songbooks?.activeSubTab || ""

    // Load songbooks on mount if not already loaded
    $: if (!Object.keys($songBooks).length) loadBooks()

    async function loadBooks() {
        const books = await loadSongBooks()
        songBooks.set(books)
    }

    $: booksList = Object.entries($songBooks).map(([id, book]) => ({
        id,
        name: book.name,
        count: book.songs.length
    }))

    $: sections = [
        [
            { id: "TITLE", label: "songbooks.all_books" },
            ...booksList.map((book) => ({
                id: book.id,
                label: book.name,
                icon: "songbooks",
                count: book.count
            }))
        ]
    ]
</script>

<NavigationSections {sections} active={activeSubTab}>
    <div slot="section_0" style="padding: 8px;">
        {#if !booksList.length}
            <MaterialButton disabled style="width: 100%;" variant="outlined" small>
                <Icon id="songbooks" size={0.9} />
                <T id="songbooks.no_book_selected" />
            </MaterialButton>
        {/if}
    </div>
</NavigationSections>
