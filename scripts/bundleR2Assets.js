const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = path.join(__dirname, "..")
const OUTPUT_ROOT = path.join(PROJECT_ROOT, "public")
const INDEX_PATH = path.join(OUTPUT_ROOT, "r2-bundle-index.json")
const DEFAULT_MANIFEST_KEY = "manifest.json"

async function bundleR2Assets({ failIfEmpty = true } = {}) {
    const config = getR2Config()
    if (!config) {
        const existing = countBundledFiles()
        if (existing.total) {
            console.warn("[bundle-r2] R2 env not configured. Using existing bundled files.")
            console.warn(`[bundle-r2] Existing songbooks: ${existing.songbooks}, bibles: ${existing.bibles}`)
            return existing
        }
        throw new Error("R2 env is not configured. Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env before building.")
    }

    console.log("[bundle-r2] Downloading R2 manifest...")
    const manifestContent = await signedGetText(config.manifestKey, config)
    if (!manifestContent) throw new Error("Could not download R2 manifest.")

    const manifest = JSON.parse(manifestContent)
    const files = Array.isArray(manifest.files) ? manifest.files : []
    if (!files.length) throw new Error("R2 manifest does not contain any files.")

    const index = readIndex()
    const nextIndex = { ...index }
    let downloaded = 0
    let skipped = 0

    for (const file of files) {
        if (!file?.path || !file.type) continue

        const localPath = getLocalPath(file)
        fs.mkdirSync(path.dirname(localPath), { recursive: true })

        const current = index[file.path]
        const exists = fs.existsSync(localPath)
        const localSize = exists ? fs.statSync(localPath).size : 0
        const indexMatches =
            exists &&
            current &&
            current.sha256 === (file.sha256 || "") &&
            current.size === (file.size || localSize)

        const fileMatches = exists && file.sha256 && file.sha256 === sha256(fs.readFileSync(localPath))
        const unchanged = indexMatches || fileMatches

        if (unchanged) {
            skipped++
            nextIndex[file.path] = {
                sha256: file.sha256 || current?.sha256 || "",
                size: file.size || localSize,
                updatedAt: current?.updatedAt || new Date().toISOString()
            }
            continue
        }

        console.log(`[bundle-r2] Downloading ${file.path}`)
        let buffer
        try {
            buffer = await signedGetBuffer(file.path, config)
        } catch (err) {
            console.warn(`[bundle-r2] ${err.message || err}`)
            continue
        }
        if (!buffer?.length) {
            console.warn(`[bundle-r2] Empty download for ${file.path}`)
            continue
        }

        fs.writeFileSync(localPath, buffer)
        downloaded++
        nextIndex[file.path] = {
            sha256: file.sha256 || sha256(buffer),
            size: typeof file.size === "number" ? file.size : buffer.length,
            updatedAt: new Date().toISOString()
        }
    }

    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true })
    fs.writeFileSync(INDEX_PATH, JSON.stringify(nextIndex, null, 2))

    const bundled = countBundledFiles()
    console.log(`[bundle-r2] Downloaded ${downloaded}, unchanged ${skipped}, total in manifest ${files.length}`)
    console.log(`[bundle-r2] Bundled songbooks: ${bundled.songbooks}, bibles: ${bundled.bibles}`)

    if (failIfEmpty && !bundled.songbooks) {
        throw new Error("No songbook files were bundled from R2.")
    }

    return bundled
}

function getLocalPath(file) {
    const relativePath = file.path.replace(/^\/+/, "")
    if (file.type === "songbook" || relativePath.startsWith("songBooks/")) {
        return path.join(OUTPUT_ROOT, "songBooks", path.basename(relativePath))
    }
    if (file.type === "bible" || relativePath.startsWith("bibles/")) {
        return path.join(OUTPUT_ROOT, "localBible", path.basename(relativePath))
    }
    return path.join(OUTPUT_ROOT, "r2Assets", ...relativePath.split("/"))
}

function countBundledFiles() {
    const bundled = {
        songbooks: listFiles(path.join(OUTPUT_ROOT, "songBooks"), [".json"]).length,
        bibles: listFiles(path.join(OUTPUT_ROOT, "localBible"), [".xml", ".json", ".fsb"]).length
    }
    bundled.total = bundled.songbooks + bundled.bibles
    return bundled
}

function listFiles(dir, extensions) {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((name) => extensions.includes(path.extname(name).toLowerCase()))
}

function readIndex() {
    try {
        if (!fs.existsSync(INDEX_PATH)) return {}
        return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"))
    } catch {
        return {}
    }
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
    const envPath = path.join(PROJECT_ROOT, ".env")
    if (!fs.existsSync(envPath)) return {}

    const output = {}
    fs.readFileSync(envPath, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .forEach((line) => {
            const separator = line.indexOf("=")
            if (separator <= 0) return
            const key = line.slice(0, separator).trim()
            let value = line.slice(separator + 1).trim()
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1)
            }
            if (key) output[key] = value
        })

    return output
}

async function signedGetText(key, config) {
    const response = await signedRequest(key, config)
    if (!response.ok) throw new Error(`R2 GET failed (${response.status}) for ${key}`)
    return response.text()
}

async function signedGetBuffer(key, config) {
    const response = await signedRequest(key, config)
    if (!response.ok) throw new Error(`R2 GET failed (${response.status}) for ${key}`)
    return Buffer.from(await response.arrayBuffer())
}

function encodeS3Path(key) {
    return key
        .split("/")
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
        .join("/")
}

async function signedRequest(key, config) {
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

    return fetch(`${endpoint.protocol}//${host}${canonicalUri}`, {
        method,
        headers: {
            "x-amz-date": amzDate,
            "x-amz-content-sha256": payloadHash,
            Authorization: authorization
        }
    })
}

function getSigningKey(secret, dateStamp, region, service) {
    const kDate = hmac(Buffer.from(`AWS4${secret}`, "utf8"), dateStamp)
    const kRegion = hmac(kDate, region)
    const kService = hmac(kRegion, service)
    return hmac(kService, "aws4_request")
}

function hmac(key, data) {
    return crypto.createHmac("sha256", key).update(data).digest()
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex")
}

module.exports = async function beforePack() {
    await bundleR2Assets({ failIfEmpty: true })
}

if (require.main === module) {
    bundleR2Assets({ failIfEmpty: true }).catch((err) => {
        console.error("[bundle-r2]", err.message || err)
        process.exit(1)
    })
}
