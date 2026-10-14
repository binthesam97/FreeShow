// ----- Kerusso -----
// Kerusso is based on FreeShow: carry over an existing FreeShow installation on the first launch
// - Documents/FreeShow is moved to Documents/Kerusso (copied if it can't be moved, e.g. if FreeShow is running)
// - app data settings (outputs, media cache, connections etc.) are copied from the FreeShow app data folder
// - absolute paths pointing into the old folder are rewritten so media & files are still found

import { app } from "electron"
import fs from "fs"
import path from "path"
import type Store from "electron-store"
import type { Config } from "../../types/Main"

const OLD_APP_NAME = "FreeShow"
const NEW_APP_NAME = "Kerusso"
// files that can contain absolute file paths
const PATH_FILE_EXTENSIONS = [".json", ".show", ".project"]
const MAX_REWRITE_SIZE = 200 * 1024 * 1024 // 200 MB

export const FREESHOW_NOTICE = "Kerusso is based on FreeShow, free and open-source software by ChurchApps and Kristoffer Vassbø, and is distributed under the GNU GPL-3.0 license.<br><br>Your existing FreeShow data has been carried over to Kerusso."

export let migratedFromFreeShow = false

export function migrateFromFreeShow(config: Store<Config>) {
    if (config.get("freeshowMigrated")) return

    // Kerusso might have been opened before this migration existed, only replace that setup if it's still unused
    const currentDataPath = config.get("dataPath")
    const replaceUnusedSetup = !!currentDataPath && isUnusedSetup(currentDataPath)

    if (!currentDataPath || replaceUnusedSetup) {
        try {
            migrate(config, replaceUnusedSetup)
        } catch (err) {
            console.error("Could not migrate FreeShow data:", err)
        }
    }

    config.set("freeshowMigrated", true)
}

function migrate(config: Store<Config>, replaceUnusedSetup: boolean) {
    const newAppDataPath = app.getPath("userData")
    const oldAppDataPath = path.join(app.getPath("appData"), OLD_APP_NAME)
    if (isSamePath(oldAppDataPath, newAppDataPath)) return

    const documentsPath = getPath("documents")
    const oldDataPath = documentsPath ? path.join(documentsPath, OLD_APP_NAME) : ""
    const newDataPath = documentsPath ? path.join(documentsPath, NEW_APP_NAME) : ""

    const hasOldAppData = fs.existsSync(path.join(oldAppDataPath, "settings.json"))
    const hasOldData = !!oldDataPath && fs.existsSync(oldDataPath)
    if (!hasOldAppData && !hasOldData) return

    console.info("Migrating existing FreeShow data to Kerusso...")

    const oldConfig = readJson(path.join(oldAppDataPath, "config.json"))
    const oldConfiguredDataPath: string = oldConfig.dataPath || ""
    const pathReplacements: [string, string][] = []
    let dataPath = ""

    if (oldConfiguredDataPath && !isSamePath(oldConfiguredDataPath, oldDataPath) && fs.existsSync(oldConfiguredDataPath)) {
        // custom data location: keep using it where it is
        dataPath = oldConfiguredDataPath
    } else if (hasOldData) {
        if (replaceUnusedSetup && !isEmptyOrMissing(newDataPath)) backupFolder(newDataPath)

        if (isEmptyOrMissing(newDataPath) && moveFolder(oldDataPath, newDataPath)) {
            dataPath = newDataPath
            pathReplacements.push([oldDataPath, newDataPath])
        } else {
            // could not move or copy, keep using the old folder so no data is lost
            dataPath = oldDataPath
        }
    }

    const copiedAppDataFiles = hasOldAppData ? copyAppDataFiles(oldAppDataPath, newAppDataPath, replaceUnusedSetup) : []

    if (pathReplacements.length) {
        rewritePathsInFolder(newDataPath, pathReplacements)
        copiedAppDataFiles.forEach((filePath) => rewritePathsInFile(filePath, pathReplacements))
    }

    if (dataPath) config.set("dataPath", dataPath)
    migratedFromFreeShow = true

    console.info(`FreeShow data migrated (data folder: ${dataPath || "default"}, settings files: ${copiedAppDataFiles.length})`)
}

// a default Kerusso data folder with nothing but the example content created on setup
function isUnusedSetup(dataPath: string) {
    const documentsPath = getPath("documents")
    if (!documentsPath || !isSamePath(dataPath, path.join(documentsPath, NEW_APP_NAME))) return false

    try {
        const showsPath = path.join(dataPath, "Shows")
        const shows = fs.existsSync(showsPath) ? fs.readdirSync(showsPath).filter((name) => name.endsWith(".show")) : []
        const mediaPath = path.join(dataPath, "Media")
        const hasMedia = fs.existsSync(mediaPath) && fs.readdirSync(mediaPath).length > 0
        return shows.length <= 1 && !hasMedia
    } catch (_) {
        return false
    }
}

// keep the replaced setup next to it instead of deleting anything
function backupFolder(folderPath: string) {
    try {
        fs.renameSync(folderPath, `${folderPath} (backup ${new Date().toISOString().slice(0, 10)} ${Date.now()})`)
    } catch (err) {
        console.warn("Could not back up the existing Kerusso data folder:", err)
    }
}

// move the folder, or copy it if it's in use
function moveFolder(from: string, to: string): boolean {
    try {
        if (fs.existsSync(to)) fs.rmdirSync(to) // empty folder
        fs.renameSync(from, to)
        return true
    } catch (err) {
        console.warn("Could not move FreeShow data folder, copying instead:", err)
    }

    try {
        fs.cpSync(from, to, { recursive: true })
        return true
    } catch (err) {
        console.error("Could not copy FreeShow data folder:", err)
        try {
            fs.rmSync(to, { recursive: true, force: true })
        } catch (_) {
            // ignore
        }
        return false
    }
}

// settings files stored next to config.json (config.json itself points to the old data folder, so it's not copied)
function copyAppDataFiles(from: string, to: string, replaceExisting: boolean): string[] {
    const copied: string[] = []
    const backupPath = path.join(to, "Kerusso setup backup")
    fs.mkdirSync(to, { recursive: true })

    fs.readdirSync(from, { withFileTypes: true }).forEach((entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "config.json") return

        const target = path.join(to, entry.name)
        try {
            if (fs.existsSync(target)) {
                if (!replaceExisting) return
                fs.mkdirSync(backupPath, { recursive: true })
                fs.renameSync(target, path.join(backupPath, entry.name))
            }

            fs.copyFileSync(path.join(from, entry.name), target)
            copied.push(target)
        } catch (err) {
            console.warn(`Could not copy FreeShow settings file ${entry.name}:`, err)
        }
    })

    return copied
}

function rewritePathsInFolder(folderPath: string, replacements: [string, string][]) {
    let entries: fs.Dirent[] = []
    try {
        entries = fs.readdirSync(folderPath, { withFileTypes: true })
    } catch (_) {
        return
    }

    entries.forEach((entry) => {
        const entryPath = path.join(folderPath, entry.name)
        if (entry.isDirectory()) rewritePathsInFolder(entryPath, replacements)
        else if (entry.isFile() && PATH_FILE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) rewritePathsInFile(entryPath, replacements)
    })
}

function rewritePathsInFile(filePath: string, replacements: [string, string][]) {
    try {
        if (fs.statSync(filePath).size > MAX_REWRITE_SIZE) return

        const content = fs.readFileSync(filePath, "utf8")
        let updated = content
        replacements.forEach(([from, to]) => {
            getPathVariants(from, to).forEach(([a, b]) => (updated = updated.replace(a, b)))
        })

        if (updated !== content) fs.writeFileSync(filePath, updated)
    } catch (err) {
        console.warn("Could not update file paths in:", filePath, err)
    }
}

// paths are stored JSON escaped ("C:\\Users\\..") and sometimes with forward slashes ("C:/Users/..")
function getPathVariants(from: string, to: string): [RegExp, string][] {
    const variants = [
        [from, to],
        [from.replace(/\\/g, "/"), to.replace(/\\/g, "/")]
    ]
    const flags = process.platform === "win32" || process.platform === "darwin" ? "gi" : "g"

    return [...new Map(variants.map(([a, b]) => [jsonEscape(a), jsonEscape(b)])).entries()].map(([a, b]) => [
        // only match the full folder name (followed by a separator or the end of the string)
        new RegExp(escapeRegExp(a) + `(?=\\\\\\\\|/|"|$)`, flags),
        b.replace(/\$/g, "$$$$")
    ])
}

function jsonEscape(value: string) {
    return JSON.stringify(value).slice(1, -1)
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isSamePath(a: string, b: string) {
    if (!a || !b) return false
    const normalize = (p: string) => path.resolve(p).replace(/[\\/]+$/, "")
    const caseInsensitive = process.platform === "win32" || process.platform === "darwin"
    return caseInsensitive ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b)
}

function isEmptyOrMissing(folderPath: string) {
    if (!folderPath) return false
    if (!fs.existsSync(folderPath)) return true
    try {
        return fs.readdirSync(folderPath).length === 0
    } catch (_) {
        return false
    }
}

function readJson(filePath: string) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8")) || {}
    } catch (_) {
        return {}
    }
}

function getPath(name: Parameters<typeof app.getPath>[0]) {
    try {
        return app.getPath(name)
    } catch (_) {
        return ""
    }
}
