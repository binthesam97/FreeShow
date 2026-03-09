import { get } from "svelte/store"
import { uid } from "uid"
import type { Item, Line } from "../../../../types/Show"
import { ShowObj } from "../../../classes/Show"
import { activeProject, drawerTabsData, outLocked, activeSongBookSong } from "../../../stores"
import { setOutput } from "../../helpers/output"
import { history } from "../../helpers/history"

// Types

export interface SongVerse {
    content: string
    order: number
    type: string // "verse" | "chorus" | "bridge" etc.
    displayNumber?: number
}

export interface Song {
    SID: string
    Song_No: number | string
    Title: string
    Audio: string
    Lyrics: {
        original: SongVerse[] | { verses: SongVerse[] }
        transliteration: SongVerse[] | { verses: SongVerse[] }
    }
    Author: string
    Scale: string
    Language: string
    Song_Book: string
    Meter: string
    Transliterated_Title: string | null
}

export interface SongBook {
    name: string
    songs: Song[]
}

// Normalize the two different lyrics formats into a flat array

export function normalizeLyrics(lyrics: SongVerse[] | { verses: SongVerse[] } | undefined | null): SongVerse[] {
    if (!lyrics) return []
    if (Array.isArray(lyrics)) return lyrics
    if (lyrics.verses && Array.isArray(lyrics.verses)) return lyrics.verses
    return []
}

// Load all songbooks from public/songBooks/

export async function loadSongBooks(): Promise<{ [id: string]: SongBook }> {
    const books: { [id: string]: SongBook } = {}

    try {
        // Fetch the directory listing - in Electron/Vite, public/ files are served at root
        const indexResponse = await fetch("./songBooks/index.json")
        let fileNames: string[] = []

        if (indexResponse.ok) {
            fileNames = await indexResponse.json()
        } else {
            // Fallback: try known files if index doesn't exist
            fileNames = ["Songs of Zion.json", "Christava Sunada Keerthanalu.json"]
        }

        for (const fileName of fileNames) {
            try {
                const response = await fetch(`./songBooks/${encodeURIComponent(fileName)}`)
                if (!response.ok) continue

                const data = await response.json()
                const name = fileName.replace(/\.json$/, "")
                const id = name.replace(/\s+/g, "_").toLowerCase()

                books[id] = {
                    name,
                    songs: data.songs || []
                }
            } catch (err) {
                console.error(`Failed to load songbook: ${fileName}`, err)
            }
        }
    } catch (err) {
        console.error("Failed to load songbooks", err)
    }

    return books
}

// Convert song lyrics into slide Items for display

export function getSongSlides(song: Song, showTransliteration: boolean = false): Item[][] {
    const lyricsSource = showTransliteration ? song.Lyrics?.transliteration : song.Lyrics?.original
    const verses = normalizeLyrics(lyricsSource)

    if (!verses.length) return []

    const slides: Item[][] = []
    const sortedVerses = [...verses].sort((a, b) => a.order - b.order)

    for (const verse of sortedVerses) {
        const lines: Line[] = verse.content.split("\n").map((line) => ({
            text: [{ value: line, style: "" }],
            align: ""
        }))

        const label = getVerseLabel(verse)

        // Add verse label as first line
        const labelLine: Line = {
            text: [{ value: label, style: "font-weight:bold;font-size:0.8em;opacity:0.7;" }],
            align: ""
        }

        const slideItems: Item[] = [
            {
                type: "text",
                lines: [labelLine, ...lines],
                style: "top:40px;left:50px;width:1820px;height:1000px;",
                align: "",
                auto: true,
                textFit: "shrinkToFit"
            }
        ]

        slides.push(slideItems)
    }

    return slides
}

function getVerseLabel(verse: SongVerse): string {
    const type = verse.type?.toLowerCase() || "verse"
    if (type === "chorus") return "Chorus"
    if (type === "bridge") return "Bridge"
    const num = verse.displayNumber || verse.order
    return `Verse ${num}`
}

// Play song - output directly to display

export function playSong() {
    if (get(outLocked)) return

    const songData = get(activeSongBookSong)
    if (!songData) return

    const showTransliteration = songData.showTransliteration || false
    const slides = getSongSlides(songData.song, showTransliteration)
    if (!slides.length) return

    const tempItems: Item[] = slides[0] || []

    // Build previous/next slides for navigation
    const previousSlides = slides.slice(0, 0).map((s) => s)
    const nextSlides = slides.slice(1).map((s) => s)

    const categoryId = get(drawerTabsData).songbooks?.activeSubTab || ""
    setOutput("slide", {
        id: "temp",
        categoryId,
        tempItems,
        previousSlides,
        nextSlides,
        settings: {}
    })
}

// Create a FreeShow Show from song lyrics

export function createSongShow() {
    const songData = get(activeSongBookSong)
    if (!songData) return

    const song = songData.song
    const showTransliteration = songData.showTransliteration || false
    const slides = getSongSlides(song, showTransliteration)
    if (!slides.length) return

    const layoutID = uid()
    const show = new ShowObj(false, null, layoutID)

    show.name = `${song.Song_No}. ${song.Title}`
    show.meta = {
        artist: song.Author || "",
        title: song.Title || ""
    }

    const slideEntries: any = {}
    const layoutSlides: any[] = []

    slides.forEach((items, i) => {
        const slideId = uid()
        const verse = normalizeLyrics(showTransliteration ? song.Lyrics?.transliteration : song.Lyrics?.original)
            .sort((a, b) => a.order - b.order)[i]

        slideEntries[slideId] = {
            group: verse ? getVerseLabel(verse) : `Slide ${i + 1}`,
            color: verse?.type === "chorus" ? "#FF851B" : null,
            settings: {},
            notes: "",
            items
        }
        layoutSlides.push({ id: slideId })
    })

    show.slides = slideEntries
    show.layouts = { [layoutID]: { name: "Default", notes: "", slides: layoutSlides } }

    history({ id: "UPDATE", newData: { data: show, remember: { project: get(activeProject) } }, location: { page: "show", id: "show" } })
}
