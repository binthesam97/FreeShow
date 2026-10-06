import { get } from "svelte/store"
import { uid } from "uid"
import type { Show } from "../../types/Show"
import type { ClientMessage } from "../../types/Socket"
import { AudioRoutingManager } from "../audio/routing/audioRoutingManager"
import { loadJsonBible } from "../components/drawer/bible/scripture"
import { loadSongBooks, createSongShow } from "../components/drawer/songbooks/songbooks"
import { clone, keysToID, removeDeleted } from "../components/helpers/array"
import { getThumbnailPath, mediaSize } from "../components/helpers/media"
import { getFirstActiveOutput, setOutput } from "../components/helpers/output"
import { loadShows } from "../components/helpers/setShow"
import { getLayoutRef } from "../components/helpers/show"
import { updateOut } from "../components/helpers/showActions"
import { _show } from "../components/helpers/shows"
import { clearAll } from "../components/output/clear"
import { REMOTE } from "./../../types/Channels"
import { actions, actionTags, activePage, activeProject, activeShow, activeTimers, audioChannelsData, audioRouting, categories, connections, dictionary, folders, language, openedFolders, outLocked, outputs, overlayCategories, overlays, playerVideos, projects, remotePassword, runningActions, scriptures, shows, showsCache, styles, templateCategories, templates, theme, themes, timers, variables, variableTags, songBooks, activeSongBookSong } from "./../stores"
import { lastClickTime } from "./common"
import { translateText } from "./language"
import { send } from "./request"
import { sendData, setConnectedState } from "./sendData"

export function getFilteredAudioChannels() {
    const rawRouting = get(audioRouting) || { channels: [{ id: "main", name: translateText("audio.main") }], connections: [] }
    const sortedConfig = AudioRoutingManager.sortChannels(rawRouting)
    const inactiveOutputIds = keysToID(get(outputs) || {}).filter((a) => !a.enabled)
    const filteredChannels = sortedConfig.channels.filter((ch) => !inactiveOutputIds.some((a) => `channel_${a.id}` === ch.id))
    return { ...sortedConfig, channels: filteredChannels }
}

// REMOTE

let currentOut = ""
let loadingShow = ""
export const receiveREMOTE: any = {
    PASSWORD: (msg: any) => {
        sendThemeToRemote()

        msg.data = {
            dictionary: get(dictionary),
            password: !!get(remotePassword).length
        }
        if (msg.data.password) return msg

        setConnectedState("REMOTE", msg.id, "entered", true)

        // msg = { id: msg.id, channel: "SHOWS_CACHE", data: filterObjectArray(get(showsCache), ["name", "private", "category", "timestamps"]) }
        msg = { id: msg.id, channel: "SHOWS", data: get(shows) }
        initializeRemote(msg.id)

        return msg
    },
    GET_SONGBOOKS: async (msg: any) => {
        let books = get(songBooks)
        if (!Object.keys(books).length) {
            books = await loadSongBooks()
            if (Object.keys(books).length) songBooks.set(books)
        }
        msg.channel = "SONGBOOKS"
        msg.data = books
        return msg
    },
    GET_SHOW: async (msg: ClientMessage) => {
        const id: string = msg.data
        if (!id) return
        const show = get(showsCache)[id]
        if (!show) return

        msg.channel = "SHOW"
        msg.data = clone({ ...(await convertBackgrounds(show)), id })
        return msg
    },
    GET_ACTIVE_SHOW: async (msg: ClientMessage) => {
        const activeS = get(activeShow)
        if (!activeS?.id) return
        const show = get(showsCache)[activeS.id]
        if (!show) return

        msg.channel = "SHOW"
        msg.data = clone({ ...(await convertBackgrounds(show)), id: activeS.id })
        return msg
    },
    ACCESS: (msg: any) => {
        if (get(remotePassword).length && msg.data !== get(remotePassword)) return { id: msg.id, channel: "ERROR", data: "wrongPass" }

        sendThemeToRemote()

        send(REMOTE, ["LANGUAGE"], { lang: get(language), strings: get(dictionary) })

        setConnectedState("REMOTE", msg.id, "entered", true)

        // msg = { id: msg.id, channel: "SHOWS_CACHE", data: filterObjectArray(get(showsCache), ["name", "private", "category", "timestamps"]) }
        msg = { id: msg.id, channel: "SHOWS", data: get(shows) }
        initializeRemote(msg.id)

        return msg
    },
    // SHOWS: (msg: any) => {
    //   msg.data = filterObjectArray(get(shows), ["name"])
    //   return msg
    // },
    SHOW: async (msg: any) => {
        const data = msg.data
        const showID = typeof data === "string" ? data : data.id
        const autoPlay = typeof data === "object" ? !!data.autoPlay : false

        if (msg.id) {
            setConnectedState("REMOTE", msg.id, "active", showID)
        }

        loadingShow = showID 
        await loadShows([showID])

        if (loadingShow !== showID) {
            console.log("[REMOTE SHOW] Aborted: loadingShow !== showID", loadingShow, showID)
            return
        }

        // Allows Svelte's internal layout reactivity loops (caused by createSongShow / history UPDATE) to fully settle natively globally before dispatching to projector engines.
        await new Promise(r => setTimeout(r, 100))

        if (autoPlay) {
            console.log("[REMOTE SHOW] Executing autoPlay for showID:", showID)
            // Ensure desktop switches to this show immediately for autoPlay
            activeShow.set({ id: showID, type: "show" })

            const layout = getLayoutRef(showID)
            const activeLayout = _show(showID).get("settings.activeLayout") || ""
            console.log("[REMOTE SHOW] Evaluated Layout Length:", layout.length, "activeLayout:", activeLayout)
            if (layout.length) {
                console.log("[REMOTE SHOW] Calling setOutput and updateOut!")
                setOutput("slide", { id: showID, layout: activeLayout, index: 0 })
                updateOut(showID, 0, layout)
            } else {
                console.log("[REMOTE SHOW] Skipped updateOut due to layout.length == 0. Raw layout:", layout)
            }
        } else {
            console.log("[REMOTE SHOW] Opening show normally (no autoPlay)")
            openShow(showID)
        }

        msg.data = clone({ ...(await convertBackgrounds(get(showsCache)[showID])), id: showID })
        return msg
    },
    OUT: async (msg: any) => {
        if (get(outLocked)) return
        // set id because convertBackgrounds might use a long time
        const currentId = uid(5)
        currentOut = currentId

        const currentOutput = getFirstActiveOutput()
        const out = currentOutput?.out?.slide || null
        let id = ""

        if (msg.data === "clear") {
            clearAll()
            return
        } else if (msg.data?.id) {
            id = msg.data.id
            await loadShows([id])

            const layout = getLayoutRef(id)
            if (msg.data.index < layout.length && msg.data.index >= 0) {
                if (!msg.data.layout) msg.data.layout = _show(id).get("settings.activeLayout")
                updateOut(msg.data.id, msg.data.index, _show(msg.data.id).layouts([msg.data.layout]).ref()[0])
                setOutput("slide", msg.data)
            }

            return
        } else if (msg.data !== null && msg.data !== undefined && out) {
            id = out.id

            const layout = getLayoutRef(id)
            if (msg.data < layout.length && msg.data >= 0) {
                const newOutSlide: any = { ...out, index: msg.data }
                setOutput("slide", newOutSlide)
            }
            msg.data = null
        } else if (out?.id === "temp") {
            msg.data = out
        } else {
            const styleRes = currentOutput?.style ? get(styles)[currentOutput?.style]?.aspectRatio || get(styles)[currentOutput?.style]?.resolution : null
            msg.data = { slide: out ? out.index : null, layout: out?.layout || null, styleRes }
            // && out.id !== oldOutSlide
            if (out && out.id !== "temp") {
                id = out.id
                oldOutSlide = id
                msg.data.show = await convertBackgrounds(get(showsCache)[id], false, true)
                msg.data.show.id = id
            }

            if (currentOut !== currentId) return
        }
        if (id?.length && msg.id) {
            setConnectedState("REMOTE", msg.id, "active", id)
        }

        return msg
    },
    OUT_DATA: (msg: any) => {
        const currentOutput = getFirstActiveOutput()
        const out = clone(currentOutput?.out || {})

        // Include player video name for online media (YouTube, Vimeo, etc.)
        if (out.background?.type === "player" && out.background?.id) {
            const playerName = get(playerVideos)[out.background.id]?.name
            if (playerName) out.background.name = playerName
        }

        msg.data = out

        return msg
    },
    PROJECTS: (msg: any) => {
        msg.data = removeDeleted(keysToID(clone(get(projects))))

        // get names
        msg.data.forEach((project) => {
            project.shows.forEach((show) => {
                if (show.type === "overlay") show.name = get(overlays)[show.id]?.name || translateText("main.unnamed")
            })

            return project
        })

        return msg
    },
    START_SONG: async (msg: ClientMessage) => {
        const { song, showTransliteration } = msg.data || {}
        if (!song) return msg
        activeSongBookSong.set({ song, showTransliteration })
        
        const showId = createSongShow()
        if (showId) {
            msg.data = showId
        }
        return msg
    },
    GET_SCRIPTURE: async (msg: ClientMessage) => {
        const { id, bookKey, chapterKey, bookIndex, chapterIndex } = msg.data || {}
        if (!id) return

        const jsonBible = await loadJsonBible(id)
        if (!jsonBible) return

        const scriptureData: any = get(scriptures)[id]
        const isApi = scriptureData?.api === true

        if (!isApi) {
            msg.data.bible = jsonBible.data
            return msg
        }

        if (bookKey && !chapterKey) {
            try {
                const bookData = await jsonBible.getBook(bookKey)
                const mapped = (bookData.data.chapters || []).map((c) => ({
                    number: c.number,
                    keyName: c.number
                }))
                msg.data.bibleUpdate = { kind: "chapters", id, bookIndex, chapters: mapped }
            } catch (error) {
                console.warn(`Failed to load book ${bookKey}:`, error)
                msg.data.bibleUpdate = { kind: "chapters", id, bookIndex, chapters: [] }
            }
            return msg
        }

        if (bookKey && chapterKey) {
            try {
                const bookData = await jsonBible.getBook(bookKey)
                const chapterData = await bookData.getChapter(chapterKey)
                const versesData = chapterData.data.verses
                const mappedVerses = versesData.map((v) => ({
                    number: v.number,
                    text: v.text,
                    keyName: v.number
                }))
                msg.data.bibleUpdate = { kind: "verses", id, bookIndex, chapterIndex, verses: mappedVerses }
            } catch (error) {
                console.warn(`Failed to load ${bookKey} ${chapterKey}:`, error)
                msg.data.bibleUpdate = { kind: "verses", id, bookIndex, chapterIndex, verses: [] }
            }
            return msg
        }

        const books = jsonBible.data.books
        const mappedBooks = (books || []).map((b) => ({
            name: b.name,
            number: b.number,
            keyName: b.id,
            chapters: []
        }))
        msg.data.bible = { books: mappedBooks }
        return msg
    },
    SEARCH_SCRIPTURE: async (msg: ClientMessage) => {
        const { id, searchTerm, searchType, bookFilter } = msg.data || {}
        if (!id || !searchTerm) return

        const jsonBible = await loadJsonBible(id)
        if (!jsonBible) return

        const scriptureData: any = get(scriptures)[id]
        const isApi = scriptureData?.api === true

        // For local bibles, return null to use cached search
        if (!isApi) {
            msg.data.searchResults = null
            return msg
        }

        try {
            if (searchType === "reference") {
                // Use bookSearch for reference parsing (e.g., "John 3:16")
                const result = jsonBible.bookSearch(searchTerm)
                if (result) {
                    // Get book name if we have book number
                    let bookName: string | null = null
                    if (result.book) {
                        const bookObj = jsonBible.data.books.find((b: any) => b.number === result.book || b.id === result.book)
                        bookName = bookObj?.name || null
                    }
                    msg.data.searchResults = {
                        type: "reference",
                        autocompleted: result.autocompleted || undefined,
                        book: result.book || null,
                        bookName: bookName,
                        chapter: result.chapter || null,
                        verses: result.verses || []
                    }
                } else {
                    msg.data.searchResults = { type: "reference", found: false }
                }
            } else {
                // Use textSearch for content search (minimum 3 characters)
                if (searchTerm.length < 3) {
                    msg.data.searchResults = { type: "text", results: [], bookFilter }
                    return msg
                }
                const results = await jsonBible.textSearch(searchTerm)
                let filteredResults = (results || []).map((ref: any) => ({
                    book: ref.book,
                    chapter: ref.chapter,
                    verseNumber: typeof ref.verse === "object" ? ref.verse.number : ref.verse,
                    reference: `${ref.book}.${ref.chapter}.${typeof ref.verse === "object" ? ref.verse.number : ref.verse}`,
                    referenceFull: ref.reference || "",
                    verseText: typeof ref.verse === "object" ? ref.verse.text : ref.text || ""
                }))

                // Apply book filter if provided
                if (bookFilter) {
                    filteredResults = filteredResults.filter((ref: any) => ref.book === bookFilter)
                }

                msg.data.searchResults = {
                    type: "text",
                    results: filteredResults.slice(0, 50),
                    bookFilter
                }
            }
        } catch (err) {
            console.error("Scripture search error:", err)
            msg.data.searchResults = { type: searchType, error: true }
        }

        return msg
    },
    GET_OVERLAYS: (msg: any) => {
        msg.data = { overlays: get(overlays), categories: get(overlayCategories) }
        return msg
    },
    GET_TEMPLATES: (msg: any) => {
        msg.data = { templates: get(templates), categories: get(templateCategories) }
        return msg
    },
    GET_FUNCTIONS: (msg: any) => {
        msg.data = {
            actions: get(actions),
            actionTags: get(actionTags),
            variables: get(variables),
            variableTags: get(variableTags),
            timers: get(timers),
            activeTimers: get(activeTimers),
            runningActions: get(runningActions)
        }
        return msg
    },
    GET_AUDIO_MIXER: (msg: any) => {
        msg.data = {
            audioRouting: getFilteredAudioChannels(),
            audioChannelsData: get(audioChannelsData)
        }
        return msg
    }
}

let oldOutSlide = ""

export async function initializeRemote(id: string) {
    // Send access confirmation to remote client
    window.api.send(REMOTE, { id, channel: "ACCESS", data: null })

    // Send initial data to remote client
    sendData(REMOTE, { channel: "PROJECTS", data: removeDeleted(keysToID(get(projects))) })
    send(REMOTE, ["FOLDERS"], { folders: get(folders), opened: get(openedFolders) })
    send(REMOTE, ["PROJECT"], get(activeProject))

    // Get current output state
    const currentOutput = getFirstActiveOutput()
    const styleRes = currentOutput?.style ? get(styles)[currentOutput?.style]?.aspectRatio || get(styles)[currentOutput?.style]?.resolution : null

    const outSlide = currentOutput?.out?.slide
    const out: any = {
        slide: outSlide ? outSlide.index : null,
        layout: outSlide?.layout || null,
        styleRes
    }
    console.log("Output channel", out);
    

    if (out.slide !== null && outSlide?.id && outSlide?.id !== "temp") {
        oldOutSlide = outSlide.id
        // Output & thumbnail
        out.show = await convertBackgrounds(get(showsCache)[oldOutSlide] || {})
        out.show.id = oldOutSlide

        // Send slide thumbnails
        const showMsg = await receiveREMOTE.SHOW({ channel: "SHOW", id, data: oldOutSlide })
        if (showMsg) window.api.send(REMOTE, showMsg)
    }

    // Send targeted initial state to this connection
    // Use sendData so the proper OUT payload is constructed (handles scripture 'temp' etc.)
    sendData(REMOTE, { id, channel: "OUT" })
    sendData(REMOTE, { id, channel: "OUT_DATA" })

    // Send additional data
    sendThemeToRemote()
    send(REMOTE, ["SCRIPTURE"], get(scriptures))
    send(REMOTE, ["CATEGORIES"], get(categories))
    send(REMOTE, ["AUDIO_ROUTING"], getFilteredAudioChannels())
    send(REMOTE, ["AUDIO_CHANNELS_DATA"], get(audioChannelsData))

    // Send songbooks — load them first if not yet in memory
    const currentBooks = get(songBooks)
    if (Object.keys(currentBooks).length) {
        send(REMOTE, ["SONGBOOKS"], currentBooks)
    } else {
        loadSongBooks().then((books) => {
            if (Object.keys(books).length) {
                songBooks.set(books)
                // listener in listeners.ts will send SONGBOOKS automatically via subscribe
            }
        })
    }
}

function sendThemeToRemote() {
    const currentThemeObj = get(themes)[get(theme)]
    if (currentThemeObj?.colors) {
        window.api.send(REMOTE, { id: null, channel: "THEME_COLORS", data: currentThemeObj.colors })
    }
}

export async function convertBackgrounds(show: Show, noLoad = false, init = false) {
    if (!show?.media) return {}

    show = clone(show)
    const mediaIds = new Set<string>()
    show.layouts[show.settings?.activeLayout]?.slides.forEach((a) => {
        if (a.background) mediaIds.add(a.background)
        Object.values(a.children || {}).forEach((child) => {
            if (child?.background) mediaIds.add(child.background)
        })
    })
    ;[...mediaIds].forEach((id) => {
        let path = show.media[id]?.path || show.media[id]?.id || ""
        if (!path) return

        if (noLoad) {
            show.media[id].path = getThumbnailPath(path, mediaSize.slideSize)
            return
        }

        const remoteConnections = Object.keys(get(connections).REMOTE || {})?.length || 0
        if (!init && remoteConnections === 0) return

        // const base64Path: string = await getBase64Path(path, mediaSize.slideSize)
        // keep paths and let remote request them lazily.
        show.media[id].path = path
    })

    return show
}

// const toBase64 = file => new Promise((resolve, reject) => {
//     const reader = new FileReader();
//     reader.readAsDataURL(file);
//     reader.onload = () => resolve(reader.result);
//     reader.onerror = error => reject(error);
// });

function openShow(id: string) {
    if (get(activePage) !== "show") return
    if (!get(shows)[id]) return
    // don't open if last interaction was less than 20 seconds ago
    if (Date.now() - lastClickTime < 20000) return

    activeShow.set({ id })
}
