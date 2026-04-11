// Custom Windows code-signing hook for electron-builder.
// Mirrors the pattern used in scripts/macos/notarize.js.
//
// For local builds: signing is skipped automatically when Azure credentials
// are absent (AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET).
//
// For CI / release builds: set those three environment variables (GitHub
// Actions secrets) and electron-builder will call this script, which then
// delegates to @electron/windows-sign with the Azure Trusted Signing options.

exports.default = async function sign(config) {
    if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_SECRET) {
        console.log("Skipping Windows code signing: AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET not set.")
        return
    }

    const { sign } = require("@electron/windows-sign")

    await sign({
        ...config,
        azureSignOptions: {
            publisherName: "Live Church Solutions",
            endpoint: "https://wus2.codesigning.azure.net/",
            certificateProfileName: "FreeShow",
            codeSigningAccountName: "FreeShow"
        }
    })
}
