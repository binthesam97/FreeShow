// Bundled local Bible auto-import
// Scans public/localBible/ at startup, parses XML, saves .fsb to user's Bibles folder,
// and writes entries into SYNCED_SETTINGS — all in the main process.
// This means entries are persisted to disk immediately and survive restarts.

import { app } from "electron"
import { XMLParser } from "fast-xml-parser"
import path from "path"
import { detectFileType } from "./bibleDetecter"
import { doesPathExist, getDataFolderPath, getExtension, readFile, readFolder, writeFile } from "../utils/files"

const SUPPORTED_EXTENSIONS = new Set(["xml", "xmm", "json", "fsb"])

// ---------- path helpers ----------

export function bundledLocalBibleDir(): string | null {
    const candidates = [
        path.join(app.getAppPath(), "public", "localBible"),
        path.join(process.resourcesPath, "app.asar.unpacked", "public", "localBible"),
        path.join(process.resourcesPath, "public", "localBible"),
        // dev: build/electron/data/ → ../../../public/localBible
        path.join(__dirname, "..", "..", "..", "public", "localBible")
    ]
    for (const dir of candidates) {
        if (doesPathExist(dir)) return dir
    }
    return null
}

/** Stable, deterministic ID for a bundled Bible (based on filename so it never changes). */
function stableId(basename: string): string {
    const safe = basename.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/, "")
    return "bundled_" + safe
}

/** Same as formatToFileName in the frontend — removes characters illegal in filenames. */
function safeName(name: string): string {
    return name.replace(/[/\\?%*:|"<>]/g, "").trim()
}

// ---------- Zefania XML parser (covers NASB, NKJV, NIV, NLT, NIRV, MSG, AMP, ESV, …) ----------

function parseZefaniaBible(content: string, fallbackName: string): { name: string; books: any[]; metadata: any } | null {
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@",
            textNodeName: "#text",
            isArray: (name) => ["BIBLEBOOK", "CHAPTER", "VERS"].includes(name)
        })
        const result = parser.parse(content)
        const xmlbible = result.XMLBIBLE
        if (!xmlbible) return null

        const info: any = xmlbible.INFORMATION || {}
        const rawName: string = info.title || xmlbible["@biblename"] || fallbackName
        const name = safeName(rawName)

        const books = (xmlbible.BIBLEBOOK || []).map((book: any) => {
            const chArr = Array.isArray(book.CHAPTER) ? book.CHAPTER : book.CHAPTER ? [book.CHAPTER] : []
            const chapters = chArr.filter(Boolean).map((ch: any) => {
                const vArr = Array.isArray(ch.VERS) ? ch.VERS : ch.VERS ? [ch.VERS] : []
                const verses = vArr.filter(Boolean).map((v: any) => {
                    const text = (typeof v === "object" ? String(v["#text"] ?? "") : String(v ?? "")).trim()
                    return { number: Number(v["@vnumber"]), text }
                })
                return { number: Number(ch["@cnumber"]), verses }
            })
            const bookData: any = {
                number: Number(book["@bnumber"]),
                name: book["@bname"] || book["@bsname"] || String(book["@bnumber"]),
                chapters
            }
            if (book["@babbr"]) bookData.abbreviation = book["@babbr"]
            return bookData
        })

        return { name, books, metadata: { ...info, copyright: info.publisher || "" } }
    } catch (err) {
        console.error("[FreeShow] Zefania parse error:", err)
        return null
    }
}

// ---------- main sync function ----------

/**
 * Scan public/localBible, parse any new files not yet in `existingScriptures`,
 * save their .fsb to the user's Bibles folder, and return the updated scriptures map.
 * Returns null when nothing changed (all files already imported).
 *
 * Called from the SYNCED_SETTINGS handler (setImmediate) so it runs after the
 * initial settings response is sent to the renderer.
 */
export function syncBundledBibles(existingScriptures: Record<string, any>): Record<string, any> | null {
    const dir = bundledLocalBibleDir()
    if (!dir) {
        console.info("[FreeShow] No public/localBible folder found — skipping bundled Bible sync.")
        return null
    }

    const bibleFolder = getDataFolderPath("scriptures")
    const updated: Record<string, any> = { ...existingScriptures }
    let changed = false

    const files = readFolder(dir).filter((n) => SUPPORTED_EXTENSIONS.has(getExtension(n)))
    console.info(`[FreeShow] Bundled Bible sync: checking ${files.length} file(s) in ${dir}`)

    for (const filename of files) {
        const basename = filename.replace(/\.[^.]+$/, "")
        const id = stableId(basename)

        if (updated[id]) {
            // already imported — verify .fsb still exists, re-save if somehow deleted
            const existingName: string = updated[id].name
            if (existingName && !doesPathExist(path.join(bibleFolder, existingName + ".fsb"))) {
                console.info(`[FreeShow] .fsb missing for ${existingName}, re-saving…`)
                // fall through to re-parse below by deleting the entry
                delete updated[id]
            } else {
                continue
            }
        }

        console.info(`[FreeShow] Importing bundled Bible: ${filename}`)
        const filePath = path.join(dir, filename)

        let parsed: { name: string; books: any[]; metadata: any } | null = null
        const ext = getExtension(filename)

        if (ext === "fsb" || ext === "json") {
            // Pre-parsed FreeShow format
            try {
                const raw = JSON.parse(readFile(filePath, "utf8"))
                const data = Array.isArray(raw) ? raw[1] : raw
                if (data && typeof data === "object") {
                    parsed = { name: safeName(data.name || basename), books: data.books || [], metadata: data.metadata || {} }
                }
            } catch {
                console.warn("[FreeShow] Could not parse FSB/JSON:", filename)
                continue
            }
        } else {
            // XML — detect format then parse
            const content = readFile(filePath, "utf8")
            const detected = detectFileType(content.slice(0, 2000))

            if (detected === "zefania") {
                parsed = parseZefaniaBible(content, basename)
            } else {
                console.warn(`[FreeShow] Unsupported format (${detected ?? "unknown"}) for bundled Bible: ${filename}`)
                continue
            }
        }

        if (!parsed || !parsed.name) {
            console.warn(`[FreeShow] Failed to parse bundled Bible: ${filename}`)
            continue
        }

        // Save .fsb to the user's Bibles folder
        const fsbPath = path.join(bibleFolder, parsed.name + ".fsb")
        writeFile(fsbPath, JSON.stringify([id, { name: parsed.name, books: parsed.books, metadata: parsed.metadata }]))
        console.info(`[FreeShow] Saved bundled Bible as ${parsed.name}.fsb`)

        // Add to scriptures (no `api` flag — treated as local/offline Bible)
        updated[id] = { name: parsed.name }
        changed = true
    }

    return changed ? updated : null
}

// ---------- used by the import UI ----------

/** Returns all files in public/localBible for the "import local" scripture UI. */
export function listBundledLocalBibleFiles(): { path: string; name: string }[] {
    const dir = bundledLocalBibleDir()
    if (!dir) return []

    return readFolder(dir)
        .filter((n) => SUPPORTED_EXTENSIONS.has(getExtension(n)))
        .map((n) => ({ path: path.join(dir, n), name: n.replace(/\.[^.]+$/, "") }))
}
