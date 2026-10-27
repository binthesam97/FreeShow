import crypto from "crypto"
import fs from "fs"
import path from "path"
import { ToMain } from "../../types/IPC/ToMain"
import { sendToMain } from "../IPC/main"
import { app } from "electron"
import { doesPathExist, getDataFolderPath, makeDir, readFile, readFolder, writeFile } from "../utils/files"

type AssetType = "songbook" | "bible"

interface R2ManifestFile {
    id: string
    type: AssetType
    name: string
    path: string
    sha256?: string
    size?: number
}

interface R2Manifest {
    version?: string
    generatedAt?: string
    files: R2ManifestFile[]
}

interface R2CacheIndex {
    [key: string]: { sha256?: string; size?: number; updatedAt: string }
}

const INDEX_FILE_NAME = "index.json"
const DEFAULT_MANIFEST_KEY = "manifest.json"

let syncPromise: Promise<void> | null = null

export function getR2SongBooksCacheDir() {
    const { songBooksCacheDir } = getCachePaths()
    makeDir(songBooksCacheDir)
    return songBooksCacheDir
}

export function getBundledSongBooksDir(): string | null {
    const candidates = [
        path.join(app.getAppPath(), "public", "songBooks"),
        path.join(process.resourcesPath, "app.asar.unpacked", "public", "songBooks"),
        path.join(process.resourcesPath, "public", "songBooks"),
        path.join(process.resourcesPath, "songBooks"),
        // dev: build/electron/data/ → ../../../public/songBooks
        path.join(__dirname, "..", "..", "..", "public", "songBooks")
    ]

    return findFirstDirWithFiles(candidates, [".json"])
}

// app.asar still contains public/songBooks & public/localBible (README only), and the R2 cache dirs are
// created empty on first run, so a dir only counts if it actually holds data files
export function findFirstDirWithFiles(candidates: string[], extensions: string[]): string | null {
    for (const dir of candidates) {
        if (!doesPathExist(dir)) continue
        try {
            if (readFolder(dir).some((name) => extensions.includes(path.extname(name).toLowerCase()))) return dir
        } catch {
            // unreadable, try next
        }
    }

    return null
}

export function listSongBookJsonFiles(dir: string): string[] {
    if (!dir || !doesPathExist(dir)) return []

    return readFolder(dir)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .map((name) => path.join(dir, name))
}

export function listAvailableSongBookFiles(): string[] {
    const filesByName = new Map<string, string>()

    listSongBookJsonFiles(getBundledSongBooksDir() || "").forEach((filePath) => {
        filesByName.set(path.basename(filePath).toLowerCase(), filePath)
    })

    // Cached/R2 copies win so testers pick up newer remote books when available
    listSongBookJsonFiles(getR2SongBooksCacheDir()).forEach((filePath) => {
        filesByName.set(path.basename(filePath).toLowerCase(), filePath)
    })

    return [...filesByName.values()]
}

export function getR2BiblesCacheDir() {
    const { biblesCacheDir } = getCachePaths()
    makeDir(biblesCacheDir)
    return biblesCacheDir
}

export function ensureR2AssetsSynced(force = false) {
    if (force || !syncPromise) {
        syncPromise = syncR2Assets().catch((err) => {
            console.error("[FreeShow] R2 sync failed:", err)
            sendSyncStatus({ status: "failed", message: "R2 sync failed." })
        })
    }
    return syncPromise
}

async function syncR2Assets() {
    const config = getR2Config()
    if (!config) {
        console.info("[FreeShow] R2 env not configured, skipping remote assets sync.")
        return
    }

    sendSyncStatus({ status: "syncing", message: "Syncing Songbooks and Bibles from R2..." })

    const { cacheBaseDir, manifestCachePath, indexPath, songBooksCacheDir, biblesCacheDir } = getCachePaths()
    makeDir(cacheBaseDir)
    makeDir(songBooksCacheDir)
    makeDir(biblesCacheDir)

    const manifestContent = await signedGetText(config.manifestKey, config)
    if (!manifestContent) return

    writeFile(manifestCachePath, manifestContent)

    let manifest: R2Manifest
    try {
        manifest = JSON.parse(manifestContent)
    } catch {
        console.warn("[FreeShow] Invalid R2 manifest JSON")
        return
    }

    const files = Array.isArray(manifest.files) ? manifest.files : []
    if (!files.length) {
        sendSyncStatus({ status: "ready", downloaded: 0, total: 0, message: "R2 assets are ready." })
        return
    }

    const index = readIndex()
    const nextIndex: R2CacheIndex = { ...index }
    let downloadedCount = 0

    for (const file of files) {
        if (!file?.path || !file.type) continue

        const localPath = path.join(cacheBaseDir, ...file.path.split("/"))
        makeDir(path.dirname(localPath))

        const exists = fs.existsSync(localPath)
        const current = index[file.path]
        const hasMatchingMetadata =
            exists &&
            current &&
            current.sha256 === (file.sha256 || "") &&
            current.size === (file.size || 0)

        if (hasMatchingMetadata) continue

        const buffer = await signedGetBuffer(file.path, config)
        if (!buffer?.length) continue

        writeFile(localPath, buffer)
        downloadedCount++
        nextIndex[file.path] = {
            sha256: file.sha256 || sha256(buffer),
            size: typeof file.size === "number" ? file.size : buffer.length,
            updatedAt: new Date().toISOString()
        }
    }

    writeFile(indexPath, JSON.stringify(nextIndex, null, 2))
    sendSyncStatus({ status: "ready", downloaded: downloadedCount, total: files.length, message: "R2 assets are ready." })
}

function readIndex(): R2CacheIndex {
    try {
        const { indexPath } = getCachePaths()
        if (!fs.existsSync(indexPath)) return {}
        const content = readFile(indexPath)
        if (!content) return {}
        return JSON.parse(content) as R2CacheIndex
    } catch {
        return {}
    }
}

function getCachePaths() {
    const cacheBaseDir = getDataFolderPath("cloud", "R2Assets")
    return {
        cacheBaseDir,
        manifestCachePath: path.join(cacheBaseDir, "manifest.json"),
        indexPath: path.join(cacheBaseDir, INDEX_FILE_NAME),
        songBooksCacheDir: path.join(cacheBaseDir, "songBooks"),
        biblesCacheDir: path.join(cacheBaseDir, "bibles")
    }
}

function sha256(buffer: Buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex")
}

function getR2Config() {
    const env = { ...loadDotEnvFallback(), ...process.env }
    const endpoint = env.R2_ENDPOINT || ""
    const bucket = env.R2_BUCKET || ""
    const accessKeyId = env.R2_ACCESS_KEY_ID || ""
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY || ""
    const region = env.R2_REGION || "auto"
    const manifestKey = env.R2_MANIFEST_KEY || DEFAULT_MANIFEST_KEY

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null

    return { endpoint, bucket, accessKeyId, secretAccessKey, region, manifestKey }
}

function loadDotEnvFallback() {
    const candidates = [path.join(process.cwd(), ".env"), path.join(__dirname, "..", "..", "..", ".env")]

    try {
        candidates.push(path.join(app.getAppPath(), ".env"))
        candidates.push(path.join(process.resourcesPath, ".env"))
    } catch {
        // app is not ready yet
    }

    const envPath = candidates.find((candidate) => fs.existsSync(candidate))
    if (!envPath) return {}

    const output: Record<string, string> = {}
    const lines = readFile(envPath)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)

    lines.forEach((line) => {
        if (line.startsWith("#")) return
        const separator = line.indexOf("=")
        if (separator <= 0) return
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim()
        if (key) output[key] = value
    })

    return output
}

async function signedGetText(key: string, config: ReturnType<typeof getR2Config>) {
    const response = await signedRequest(key, config!)
    if (!response.ok) {
        console.warn(`[FreeShow] R2 GET failed (${response.status}) for ${key}`)
        sendSyncStatus({ status: "failed", message: `R2 GET failed (${response.status}) for ${key}` })
        return ""
    }
    return await response.text()
}

async function signedGetBuffer(key: string, config: ReturnType<typeof getR2Config>) {
    const response = await signedRequest(key, config!)
    if (!response.ok) {
        console.warn(`[FreeShow] R2 GET failed (${response.status}) for ${key}`)
        sendSyncStatus({ status: "failed", message: `R2 GET failed (${response.status}) for ${key}` })
        return Buffer.alloc(0)
    }
    const arr = await response.arrayBuffer()
    return Buffer.from(arr)
}

function encodeS3Path(key: string) {
    return key
        .split("/")
        .filter(Boolean)
        .map((segment) =>
            encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
        )
        .join("/")
}

async function signedRequest(key: string, config: NonNullable<ReturnType<typeof getR2Config>>) {
    const endpoint = new URL(config.endpoint)
    const host = endpoint.host
    const method = "GET"

    const canonicalUri = `/${config.bucket}/${encodeS3Path(key)}`
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "")
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = crypto.createHash("sha256").update("").digest("hex")
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date"
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n")
    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n")
    const signingKey = getSigningKey(config.secretAccessKey, dateStamp, config.region, "s3")
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")
    const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const url = `${endpoint.protocol}//${host}${canonicalUri}`
    return fetch(url, {
        method,
        headers: {
            "x-amz-date": amzDate,
            "x-amz-content-sha256": payloadHash,
            Authorization: authorization
        }
    })
}

function getSigningKey(secret: string, dateStamp: string, region: string, service: string) {
    const kDate = hmac(Buffer.from(`AWS4${secret}`, "utf8"), dateStamp)
    const kRegion = hmac(kDate, region)
    const kService = hmac(kRegion, service)
    return hmac(kService, "aws4_request")
}

function hmac(key: Buffer, data: string) {
    return crypto.createHmac("sha256", key).update(data).digest()
}

function sendSyncStatus(data: { status: "syncing" | "ready" | "failed"; message?: string; downloaded?: number; total?: number }) {
    sendToMain(ToMain.R2_ASSET_SYNC, data)
}
