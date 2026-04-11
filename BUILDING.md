# Building FreeShow

This guide covers how to compile and package FreeShow for **macOS**, **Windows**, and **Linux** from source.

---

## Prerequisites (all platforms)

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org/en/download/) | 20+ | LTS recommended |
| [Python](https://www.python.org/downloads/) | 3.12 | Required by native node modules |
| [`setuptools`](https://pypi.org/project/setuptools/) | latest | `pip install setuptools` |
| npm packages | — | Run `npm install` in the project root |

Clone the repo and install dependencies first:

```bash
git clone https://github.com/ChurchApps/FreeShow.git
cd FreeShow
npm install
```

---

## Step 1 — Compile the source

This step compiles the frontend (Vite), all server bundles (remote/stage/controller/output_stream), and the Electron main process (TypeScript):

```bash
npm run build
```

Expected output: `public/build/bundle.js`, `build/electron/` directory.

---

## Step 2 — Package for your target platform

### macOS

#### Requirements

- macOS machine (Apple Silicon or Intel)
- Xcode Command Line Tools: `xcode-select --install`
- An **Apple Distribution** certificate in your Keychain (for signed builds)

#### Build (unsigned / local testing)

```bash
npx electron-builder --mac --arm64 --dir --config config/building/electron-builder.yaml
```

Replace `--arm64` with `--x64` for Intel Macs, or omit the arch flag to build both.

Output: `dist/mac-arm64/FreeShow.app`

#### Build DMG installer (signed)

```bash
npx electron-builder --mac --config config/building/electron-builder.yaml
```

This produces both `arm64` and `x64` DMG + ZIP artifacts in `dist/`.

> **Note:** The `afterSign` hook in `scripts/macos/notarize.js` runs after signing. It skips
> notarization automatically when the following environment variables are absent. Set them
> for App Store / distribution notarization:
>
> ```bash
> export APPLE_ID="your@apple.id"
> export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
> export APPLE_TEAM_ID="XXXXXXXXXX"
> ```

---

### Windows

#### Requirements

Building a Windows installer **from Windows** is straightforward. Cross-compiling from macOS/Linux requires one of:

- **Windows machine** (recommended for signed NSIS installers)
- **PowerShell** (`pwsh`) installed on macOS/Linux — used by electron-builder to patch ASAR integrity into the `.exe`
- **Wine** — alternative to PowerShell for the same step

##### Install PowerShell on macOS (for cross-compilation)

Download the `.pkg` from [PowerShell Releases](https://github.com/PowerShell/PowerShell/releases) and install it:

```bash
# Example for Apple Silicon (arm64) — check releases page for latest version
curl -LO https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/powershell-7.4.6-osx-arm64.pkg
sudo installer -pkg powershell-7.4.6-osx-arm64.pkg -target /
```

##### Install Wine on macOS (alternative)

```bash
brew install --cask wine-stable
```

#### Build Windows directory (no installer, no code signing)

```bash
npx electron-builder --win --dir --config config/building/electron-builder.yaml
```

Output: `dist/win-unpacked/FreeShow.exe`

#### Build NSIS installer (signed, from Windows)

```bash
npx electron-builder --win --config config/building/electron-builder.yaml
```

Output: `dist/FreeShow-<version>-<arch>.exe`

> **Note:** The config includes Azure code signing (`azureSignOptions`). Signing is skipped
> automatically when the Azure credentials are not configured. To enable signing, set up
> [Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/) and
> ensure the Azure CLI is authenticated.

#### Platform-specific setup (Windows only)

- Install [Visual Studio](https://visualstudio.microsoft.com/downloads/) with the **"Desktop development with C++"** workload selected
- Also select **"Windows 10 SDK"** in the installer
- These are required to compile native Node.js modules (`better-sqlite3`, `@discordjs/opus`, etc.)

---

### Linux

#### Requirements

```bash
sudo apt-get install libfontconfig1-dev   # Debian / Ubuntu
sudo dnf install fontconfig-devel         # Fedora / RHEL
```

#### Build AppImage (recommended)

```bash
npx electron-builder --linux AppImage --config config/building/electron-builder.yaml
```

Output: `dist/FreeShow-<version>.AppImage`

#### Build all Linux targets (AppImage + deb + rpm)

```bash
npx electron-builder --linux --config config/building/electron-builder.yaml
```

Output artifacts in `dist/`:
- `FreeShow-<version>.AppImage`
- `freeshow_<version>_amd64.deb`
- `freeshow-<version>.x86_64.rpm`

> **Note:** Building `.deb` and `.rpm` on a non-Debian/non-RPM system may require
> the respective packaging tools (`dpkg-deb`, `rpmbuild`) to be installed.

---

## Combined one-liner (compile + package)

```bash
# macOS arm64 (directory, no signing)
npm run build && npx electron-builder --mac --arm64 --dir --config config/building/electron-builder.yaml

# Windows (directory, no signing) — requires pwsh or wine
npm run build && npx electron-builder --win --dir --config config/building/electron-builder.yaml

# Linux AppImage
npm run build && npx electron-builder --linux AppImage --config config/building/electron-builder.yaml
```

---

## Output directory

All packaged artifacts are placed in the `dist/` folder:

| Platform | Directory / file |
|---|---|
| macOS (dir) | `dist/mac-arm64/FreeShow.app` |
| macOS (DMG) | `dist/FreeShow-<version>-arm64.dmg` |
| Windows (dir) | `dist/win-unpacked/FreeShow.exe` |
| Windows (NSIS) | `dist/FreeShow-<version>-x64.exe` |
| Linux AppImage | `dist/FreeShow-<version>.AppImage` |
| Linux deb | `dist/freeshow_<version>_amd64.deb` |
| Linux rpm | `dist/freeshow-<version>.x86_64.rpm` |

---

## Development mode (no packaging)

To run the app locally for development without building a distributable:

```bash
npm start
```

This starts the Vite dev server and Electron together with hot-module reloading.
