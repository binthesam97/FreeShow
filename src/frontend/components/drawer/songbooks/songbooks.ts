import { get } from "svelte/store"
import { uid } from "uid"
import type { Item } from "../../../../types/Show"
import { ShowObj } from "../../../classes/Show"
import { activeProject, drawerTabsData, outLocked, activeSongBookSong } from "../../../stores"
import { setOutput } from "../../helpers/output"
import { history } from "../../helpers/history"
import { requestMain } from "../../../IPC/main"
import { Main } from "../../../../types/IPC/Main"
import { fitSongbookSlides } from "./songbookFitter"

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
        let fileNames: string[] = (await requestMain(Main.READ_SONGBOOKS)) || []

        if (!fileNames.length) {
            fileNames = ["Songs of Zion.json", "Christava Sunada Keerthanalu.json"]
        }

        for (const fileName of fileNames) {
            try {
                const response = await fetch(`./songBooks/${encodeURIComponent(fileName)}`)
                if (!response.ok) continue

                const data = await response.json()

                const name = fileName
                    .replace(/\.json$/i, "")
                    .replace(/[_-]/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())

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

// Play song - output directly to display (like playScripture)

export function playSong() {
    if (get(outLocked)) {
        console.log("[playSong] Blocked: output is locked")
        return
    }

    const songData = get(activeSongBookSong)
    if (!songData) {
        console.log("[playSong] Blocked: no active song selected")
        return
    }

    const song = songData.song
    console.log("[playSong] Song:", song.Song_No, song.Title)
    console.log("[playSong] Raw Lyrics.original:", song.Lyrics?.original)
    console.log("[playSong] Raw Lyrics.transliteration:", song.Lyrics?.transliteration)

    const originalVerses = normalizeLyrics(song.Lyrics?.original)
    const transliterationVerses = normalizeLyrics(song.Lyrics?.transliteration)
    const hasTransliteration = transliterationVerses.length > 0 && songData.showTransliteration

    console.log("[playSong] originalVerses count:", originalVerses.length)
    console.log("[playSong] transliterationVerses count:", transliterationVerses.length)
    console.log("[playSong] hasTransliteration:", hasTransliteration)

    const fitResult = fitSongbookSlides(originalVerses, transliterationVerses, hasTransliteration)
    console.log("[playSong] fitResult.slides count:", fitResult.slides.length)
    console.log("[playSong] fitResult.context.templateId:", fitResult.context.templateId)
    console.log("[playSong] fitResult.context.lyricBoxes count:", fitResult.context.lyricBoxes.length)

    if (!fitResult.slides.length) {
        console.log("[playSong] Blocked: no slides generated from fitSongbookSlides")
        return
    }

    const slides: Item[][] = fitResult.slides.map((slide) => slide.items)
    const slideDynamicValues: { [key: string]: string }[] = fitResult.slides.map((slide) => slide.dynamicValues)

    const tempItems: Item[] = slides[0] || []
    const previousSlides = slides.slice(0, 0)
    const nextSlides = slides.slice(1)
    const nextSlideDynamicValues = slideDynamicValues.slice(1)

    const categoryId = get(drawerTabsData).songbooks?.activeSubTab || ""
    const translations = hasTransliteration ? 2 : 1

    console.log("[playSong] tempItems count:", tempItems.length)
    console.log("[playSong] tempItems:", JSON.stringify(tempItems, null, 2))
    console.log("[playSong] customDynamicValues (slide 0):", slideDynamicValues[0])
    console.log("[playSong] translations:", translations)
    console.log("[playSong] categoryId:", categoryId)
    console.log("[playSong] Calling setOutput with slide id=temp")

    setOutput("slide", {
        id: "temp",
        categoryId,
        tempItems,
        previousSlides,
        nextSlides,
        nextSlideDynamicValues,
        translations,
        settings: {},
        customDynamicValues: slideDynamicValues[0]
    })
}

// Create a FreeShow Show from song lyrics

export function createSongShow() {
    const songData = get(activeSongBookSong)
    if (!songData) return

    const song = songData.song

    const originalVerses = normalizeLyrics(song.Lyrics?.original)
    const transliterationVerses = normalizeLyrics(song.Lyrics?.transliteration)
    const hasTransliteration = transliterationVerses.length > 0 && songData.showTransliteration
    const fitResult = fitSongbookSlides(originalVerses, transliterationVerses, hasTransliteration)
    if (!fitResult.slides.length) return

    const layoutID = uid()
    const show = new ShowObj(false, null, layoutID, Date.now(), false)
    show.settings.template = null

    show.name = `${song.Song_No}. ${song.Title}`
    show.meta = {
        artist: song.Author || "",
        title: song.Title || ""
    }

    const slideEntries: any = {}
    const layoutSlides: any[] = []

    fitResult.slides.forEach((slide) => {
        const slideId = uid()

        slideEntries[slideId] = {
            group: slide.label,
            color: slide.verseType?.toLowerCase() === "chorus" ? "#FF851B" : null,
            settings: {},
            notes: "",
            items: slide.items
        }
        layoutSlides.push({ id: slideId })
    })

    show.slides = slideEntries
    show.layouts = { [layoutID]: { name: "Default", notes: "", slides: layoutSlides } }

    history({ id: "UPDATE", newData: { data: show, remember: { project: get(activeProject) } }, location: { page: "show", id: "show" } })
}
