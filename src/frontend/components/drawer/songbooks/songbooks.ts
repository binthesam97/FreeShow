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
    language?: string
    [key: string]: any
}

interface SongSearchField {
    value: string
    words: string[]
    weight: number
}

export interface SongSearchEntry {
    song: Song
    sortNumber: number
    fields: SongSearchField[]
    combinedTitle: string
}

// Normalize the two different lyrics formats into a flat array

export function normalizeLyrics(lyrics: SongVerse[] | { verses: SongVerse[] } | undefined | null): SongVerse[] {
    if (!lyrics) return []
    if (Array.isArray(lyrics)) return lyrics
    if (lyrics.verses && Array.isArray(lyrics.verses)) return lyrics.verses
    return []
}

export function sortSongsByNumber(a: Song, b: Song) {
    const numA = getSongSortNumber(a)
    const numB = getSongSortNumber(b) 
    return numA - numB
}

export function createSongSearchEntry(song: Song): SongSearchEntry {
    const title = normalizeSearchText(song.Title || "")
    const transliteratedTitle = normalizeSearchText(song.Transliterated_Title || "")
    const author = normalizeSearchText(song.Author || "")
    const songBook = normalizeSearchText(song.Song_Book || "")
    const songNumber = normalizeSearchText(`${song.Song_No ?? ""}`)
    const originalLyrics = normalizeSearchText(normalizeLyrics(song.Lyrics?.original).map((verse) => verse.content || "").join(" "))
    const transliteratedLyrics = normalizeSearchText(normalizeLyrics(song.Lyrics?.transliteration).map((verse) => verse.content || "").join(" "))

    const fields: SongSearchField[] = [
        createSearchField(songNumber, 1.18),
        createSearchField(title, 1),
        createSearchField(transliteratedTitle, 0.88),
        createSearchField(author, 0.52),
        createSearchField(songBook, 0.42),
        createSearchField(originalLyrics, 0.38),
        createSearchField(transliteratedLyrics, 0.38)
    ].filter((field) => field.value.length)

    return {
        song,
        sortNumber: getSongSortNumber(song),
        fields,
        combinedTitle: [title, transliteratedTitle].filter(Boolean).join(" ")
    }
}

export function searchSongbookSongs(entries: SongSearchEntry[], query: string): Song[] {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) return [...entries].sort((a, b) => a.sortNumber - b.sortNumber).map((entry) => entry.song)

    const tokens = tokenizeSearch(normalizedQuery)
    if (!tokens.length) return [...entries].sort((a, b) => a.sortNumber - b.sortNumber).map((entry) => entry.song)

    const minimumScore = getMinimumScore(tokens)

    return entries
        .map((entry) => ({
            song: entry.song,
            sortNumber: entry.sortNumber,
            score: scoreSongSearchEntry(entry, normalizedQuery, tokens)
        }))
        .filter((entry) => entry.score >= minimumScore)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            return a.sortNumber - b.sortNumber
        })
        .map((entry) => entry.song)
}

function createSearchField(value: string, weight: number): SongSearchField {
    return { value, words: tokenizeSearch(value), weight }
}

function scoreSongSearchEntry(entry: SongSearchEntry, normalizedQuery: string, tokens: string[]) {
    const maxWeight = Math.max(...entry.fields.map((field) => field.weight), 1)
    let total = 0
    let matchedTokens = 0

    tokens.forEach((token) => {
        let bestScore = 0

        entry.fields.forEach((field) => {
            const tokenScore = scoreTokenAgainstField(token, field)
            if (tokenScore > bestScore) bestScore = tokenScore
        })

        total += Math.min(bestScore / maxWeight, 1)
        if (bestScore / maxWeight >= 0.28) matchedTokens++
    })

    const tokenAverage = total / tokens.length
    const coverage = matchedTokens / tokens.length
    const phraseScore = Math.max(...entry.fields.map((field) => scorePhrase(normalizedQuery, field.value) * (field.weight / maxWeight)), scorePhrase(normalizedQuery, entry.combinedTitle))

    return tokenAverage * 0.78 + coverage * 0.16 + phraseScore * 0.06
}

function scoreTokenAgainstField(token: string, field: SongSearchField) {
    if (!field.value.length) return 0

    let best = scorePhrase(token, field.value)
    field.words.forEach((word) => {
        best = Math.max(best, scoreWord(token, word))
    })

    const subsequenceScore = scoreSubsequence(token, field.value)
    best = Math.max(best, subsequenceScore)

    return best * field.weight
}

function scorePhrase(query: string, value: string) {
    if (!query.length || !value.length) return 0
    if (query === value) return 1
    if (value.startsWith(query)) return 0.97

    const wordStart = value.indexOf(` ${query}`)
    if (wordStart >= 0) return 0.91

    const index = value.indexOf(query)
    if (index >= 0) {
        const positionPenalty = Math.min(index / Math.max(value.length, 1), 0.4)
        return 0.86 - positionPenalty * 0.3
    }

    return 0
}

function scoreWord(query: string, word: string) {
    if (!query.length || !word.length) return 0
    if (query === word) return 1
    if (word.startsWith(query)) return 0.95

    const queryIndex = word.indexOf(query)
    if (queryIndex >= 0) {
        const positionPenalty = Math.min(queryIndex / Math.max(word.length, 1), 0.4)
        return 0.82 - positionPenalty * 0.2
    }

    let best = scoreSubsequence(query, word)

    if (query.length >= 3) {
        const maxDistance = getMaxEditDistance(query.length, word.length)
        const distance = boundedLevenshtein(query, word, maxDistance)
        if (distance <= maxDistance) {
            const similarity = 1 - distance / Math.max(query.length, word.length, 1)
            best = Math.max(best, 0.58 + similarity * 0.32)
        }
    }

    return best
}

function scoreSubsequence(query: string, value: string) {
    if (!query.length || !value.length) return 0

    let queryIndex = 0
    let firstMatch = -1
    let lastMatch = -1
    let contiguous = 0
    let longestContiguous = 0

    for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex++) {
        if (value[valueIndex] !== query[queryIndex]) continue

        if (firstMatch === -1) firstMatch = valueIndex
        if (lastMatch === valueIndex - 1) contiguous++
        else contiguous = 1

        longestContiguous = Math.max(longestContiguous, contiguous)
        lastMatch = valueIndex
        queryIndex++
    }

    if (queryIndex !== query.length) return 0

    const span = Math.max(lastMatch - firstMatch + 1, 1)
    const compactness = query.length / span
    const contiguousBonus = longestContiguous / query.length
    const startBonus = firstMatch <= 1 ? 0.08 : firstMatch <= 4 ? 0.04 : 0

    return Math.min(0.55 + compactness * 0.22 + contiguousBonus * 0.15 + startBonus, 0.89)
}

function boundedLevenshtein(a: string, b: string, maxDistance: number) {
    const aLength = a.length
    const bLength = b.length
    if (!aLength) return bLength
    if (!bLength) return aLength
    if (Math.abs(aLength - bLength) > maxDistance) return maxDistance + 1

    let previous = Array.from({ length: bLength + 1 }, (_, index) => index)
    let current = new Array<number>(bLength + 1)

    for (let row = 1; row <= aLength; row++) {
        current[0] = row
        let rowMin = current[0]

        for (let column = 1; column <= bLength; column++) {
            const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1
            current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + substitutionCost)
            rowMin = Math.min(rowMin, current[column])
        }

        if (rowMin > maxDistance) return maxDistance + 1
        ;[previous, current] = [current, previous]
    }

    return previous[bLength]
}

function getMaxEditDistance(queryLength: number, wordLength: number) {
    const maxLength = Math.max(queryLength, wordLength)
    if (maxLength <= 4) return 1
    if (maxLength <= 8) return 2
    return 3
}

function getMinimumScore(tokens: string[]) {
    if (tokens.length === 1) return tokens[0].length <= 2 ? 0.52 : 0.34
    return 0.26
}

function tokenizeSearch(value: string) {
    return value.split(/\s+/).filter(Boolean)
}

function normalizeSearchText(value: string) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
}

function getSongSortNumber(song: Song) {
    return typeof song.Song_No === "number" ? song.Song_No : parseInt(song.Song_No) || 0
}

// Load all songbooks from public/songBooks/

export async function loadSongBooks(): Promise<{ [id: string]: SongBook }> {
    const books: { [id: string]: SongBook } = {}

    try {
        let fileNames: string[] = (await requestMain(Main.READ_SONGBOOKS)) || []

        for (const filePath of fileNames) {
            try {
                const fileContent = (await requestMain(Main.READ_FILE, { path: filePath }))?.content
                if (!fileContent) continue
                const data = JSON.parse(fileContent)
                const fileName = filePath.split(/[/\\]/).pop() || filePath

                const name = fileName
                    .replace(/\.json$/i, "")
                    .replace(/[_-]/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())

                const id = name.replace(/\s+/g, "_").toLowerCase()

                books[id] = {
                    ...data,
                    name,
                    songs: data.songs || []
                }
            } catch (err) {
                console.error(`Failed to load songbook: ${filePath}`, err)
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

    const fitResult = fitSongbookSlides(originalVerses, transliterationVerses, hasTransliteration, {
        songBookName: song.Song_Book || "",
        songNumber: song.Song_No
    })
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
    const fitResult = fitSongbookSlides(originalVerses, transliterationVerses, hasTransliteration, {
        songBookName: song.Song_Book || "",
        songNumber: song.Song_No
    })
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
    return show.id
}
