// From https://github.com/simonw/til/blob/main/electron/sign-notarize-electron-macos.md
// Based on https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/

const { execSync } = require("child_process")
const { notarize } = require("@electron/notarize")

// Created once with: xcrun notarytool store-credentials "freeshow-notarize" --apple-id <email> --team-id <TEAMID>
const DEFAULT_KEYCHAIN_PROFILE = "freeshow-notarize"

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context
    if (electronPlatformName !== "darwin") return

    const credentials = getCredentials()
    if (!credentials) {
        console.log(`Skipping notarization: set APPLE_KEYCHAIN_PROFILE (or store "${DEFAULT_KEYCHAIN_PROFILE}"), or APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID.`)
        return
    }

    const appName = context.packager.appInfo.productFilename

    return await notarize({
        appBundleId: "app.kerusso",
        appPath: `${appOutDir}/${appName}.app`,
        ...credentials
    })
}

function getCredentials() {
    if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) {
        return { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD, teamId: process.env.APPLE_TEAM_ID }
    }

    const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE || DEFAULT_KEYCHAIN_PROFILE
    if (hasKeychainProfile(keychainProfile)) return { keychainProfile }

    return null
}

function hasKeychainProfile(profile) {
    try {
        execSync(`xcrun notarytool history --keychain-profile "${profile}"`, { stdio: "ignore" })
        return true
    } catch {
        return false
    }
}
