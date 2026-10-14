import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ root: "" }))

vi.mock("electron", () => ({
    app: {
        getPath: (name: string) => {
            const path = require("path")
            if (name === "appData") return path.join(h.root, "AppData")
            if (name === "userData") return path.join(h.root, "AppData", "Kerusso")
            if (name === "documents") return path.join(h.root, "Documents")
            return h.root
        }
    }
}))

function createConfig(initial: { [key: string]: any } = {}) {
    const values: { [key: string]: any } = { ...initial }
    return { get: (key: string) => values[key], set: (key: string, value: any) => (values[key] = value) } as any
}

function write(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
}

async function loadModule() {
    vi.resetModules()
    return await import("./migrateFreeShow")
}

describe("migrateFromFreeShow", () => {
    let oldData: string
    let newData: string
    let oldAppData: string
    let newAppData: string

    beforeEach(() => {
        h.root = fs.mkdtempSync(path.join(os.tmpdir(), "kerusso-migrate-"))
        oldData = path.join(h.root, "Documents", "FreeShow")
        newData = path.join(h.root, "Documents", "Kerusso")
        oldAppData = path.join(h.root, "AppData", "FreeShow")
        newAppData = path.join(h.root, "AppData", "Kerusso")
    })

    afterEach(() => {
        fs.rmSync(h.root, { recursive: true, force: true })
    })

    it("moves Documents/FreeShow, copies settings and rewrites media paths", async () => {
        const mediaPath = path.join(oldData, "Media", "bg.jpg")
        const otherPath = path.join(h.root, "Documents", "FreeShowExtra", "a.jpg")
        write(path.join(oldData, "Shows", "Song.show"), JSON.stringify(["Song", { media: { a: { path: mediaPath } }, other: otherPath }]))
        write(path.join(oldData, "Config", "settings_synced.json"), JSON.stringify({ folder: oldData.replace(/\\/g, "/") + "/Media" }))
        write(path.join(oldAppData, "settings.json"), JSON.stringify({ initialized: true, mediaFolder: path.join(oldData, "Media") }))
        write(path.join(oldAppData, "config.json"), JSON.stringify({ dataPath: oldData }))

        const { migrateFromFreeShow } = await loadModule()
        const config = createConfig()
        migrateFromFreeShow(config)
        const { migratedFromFreeShow } = await import("./migrateFreeShow")

        expect(migratedFromFreeShow).toBe(true)
        expect(config.get("dataPath")).toBe(newData)
        expect(fs.existsSync(oldData)).toBe(false)
        expect(fs.existsSync(path.join(newAppData, "config.json"))).toBe(false)

        const show = JSON.parse(fs.readFileSync(path.join(newData, "Shows", "Song.show"), "utf8"))
        expect(show[1].media.a.path).toBe(path.join(newData, "Media", "bg.jpg"))
        expect(show[1].other).toBe(otherPath)

        const synced = JSON.parse(fs.readFileSync(path.join(newData, "Config", "settings_synced.json"), "utf8"))
        expect(synced.folder).toBe(newData.replace(/\\/g, "/") + "/Media")

        const settings = JSON.parse(fs.readFileSync(path.join(newAppData, "settings.json"), "utf8"))
        expect(settings.initialized).toBe(true)
        expect(settings.mediaFolder).toBe(path.join(newData, "Media"))
    })

    it("keeps a custom data location in place", async () => {
        const custom = path.join(h.root, "Custom")
        fs.mkdirSync(custom)
        write(path.join(oldAppData, "settings.json"), "{}")
        write(path.join(oldAppData, "config.json"), JSON.stringify({ dataPath: custom }))

        const { migrateFromFreeShow } = await loadModule()
        const config = createConfig()
        migrateFromFreeShow(config)

        expect(config.get("dataPath")).toBe(custom)
        expect(fs.existsSync(custom)).toBe(true)
    })

    it("does nothing when Kerusso is already in use", async () => {
        write(path.join(oldData, "Shows", "Song.show"), "[]")
        write(path.join(newData, "Shows", "Welcome.show"), "[]")
        write(path.join(newData, "Shows", "My song.show"), "[]")

        const { migrateFromFreeShow } = await loadModule()
        const config = createConfig({ dataPath: newData })
        migrateFromFreeShow(config)

        expect(fs.existsSync(oldData)).toBe(true)
        expect(fs.readdirSync(path.join(newData, "Shows"))).toHaveLength(2)
        expect(config.get("freeshowMigrated")).toBe(true)
    })

    it("replaces an unused earlier Kerusso setup and keeps a backup of it", async () => {
        write(path.join(oldData, "Shows", "Song.show"), "[]")
        write(path.join(oldAppData, "settings.json"), JSON.stringify({ initialized: true, from: "freeshow" }))
        write(path.join(newData, "Shows", "Welcome.show"), "[]")
        write(path.join(newAppData, "settings.json"), JSON.stringify({ initialized: true, from: "kerusso" }))

        const { migrateFromFreeShow } = await loadModule()
        const config = createConfig({ dataPath: newData })
        migrateFromFreeShow(config)

        expect(fs.existsSync(path.join(newData, "Shows", "Song.show"))).toBe(true)
        expect(fs.existsSync(path.join(newData, "Shows", "Welcome.show"))).toBe(false)
        expect(fs.existsSync(oldData)).toBe(false)
        expect(fs.readdirSync(path.join(h.root, "Documents")).some((name) => name.startsWith("Kerusso (backup"))).toBe(true)

        expect(JSON.parse(fs.readFileSync(path.join(newAppData, "settings.json"), "utf8")).from).toBe("freeshow")
        expect(JSON.parse(fs.readFileSync(path.join(newAppData, "Kerusso setup backup", "settings.json"), "utf8")).from).toBe("kerusso")
    })

    it("only runs once", async () => {
        write(path.join(oldData, "Shows", "Song.show"), "[]")

        const { migrateFromFreeShow } = await loadModule()
        const config = createConfig({ freeshowMigrated: true })
        migrateFromFreeShow(config)

        expect(fs.existsSync(oldData)).toBe(true)
        expect(config.get("dataPath")).toBeUndefined()
    })

    it("does nothing without a FreeShow installation", async () => {
        const { migrateFromFreeShow } = await loadModule()
        const config = createConfig()
        migrateFromFreeShow(config)
        const { migratedFromFreeShow } = await import("./migrateFreeShow")

        expect(migratedFromFreeShow).toBe(false)
        expect(config.get("dataPath")).toBeUndefined()
    })
})
