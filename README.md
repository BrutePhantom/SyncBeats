# 🎵 Syncbeats

**Synchronized local-network music listening — host once, everyone jams together.**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Android-blue)](#building-for-distribution)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/electron-44-blueviolet)](https://www.electronjs.org/)
[![Expo](https://img.shields.io/badge/expo-SDK%2058-black)](https://expo.dev/)
[![License](https://img.shields.io/badge/license-MIT-orange)](#license)

---

## What is Syncbeats?

Syncbeats is a **real-time, synchronized music player** for local networks. One person starts the server, everyone else on the same Wi-Fi or LAN connects — and the music plays in perfect sync across all devices.

There is no cloud, no streaming subscription, and no latency from the internet. All audio streams directly from the host machine over your local network. The host drops MP3 files into a folder and the library appears on every connected device automatically.

The system consists of three parts working together:

- **Backend server** — a Node.js process that serves songs, manages the room, and broadcasts playback events over Socket.io.
- **Desktop app** — an Electron + React client that auto-discovers the server on your LAN without any manual IP entry.
- **Mobile app** — a React Native / Expo app that does the same subnet scan and plays audio from the host's library.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Local Network (LAN / Wi-Fi)        │
│                                                      │
│  ┌──────────────────────────┐                        │
│  │   syncbeats-backend      │  :5000 (HTTP + WS)    │
│  │   Node · Express · Prisma│◄──────────────────┐   │
│  │   Socket.io · SQLite     │                   │   │
│  └────────────┬─────────────┘                   │   │
│               │  REST + Socket.io                │   │
│    ┌──────────┼──────────┐                       │   │
│    ▼          ▼          ▼                       │   │
│  Desktop    Desktop   Mobile      (up to N       │   │
│  (Electron) (Electron) (Expo)      clients)──────┘   │
└─────────────────────────────────────────────────────┘
```

| Flow | Detail |
|------|--------|
| Song library | `GET /songs` → JSON list |
| Audio stream | `GET /songs/:filename` → audio bytes |
| Play / Pause / Seek | Socket.io events broadcast to all clients |
| New song added | `fs.watch` → Prisma upsert → `songs-updated` Socket.io broadcast |
| Auto-discovery | App scans every IP on the /24 subnet for `:5000/health` |

---

## Repository Structure

```
Major-project-syncbeats/
├── syncbeats-backend/      # Express + Socket.io + Prisma server
│   ├── index.js            # Entry point
│   ├── prisma/
│   │   ├── schema.prisma   # Song model
│   │   └── dev.db          # SQLite database (auto-created)
│   └── public/songs/       # 🎵 Drop your MP3s here
│
├── syncbeats-desktop/      # Electron + Vite + React desktop app
│   ├── src/
│   │   ├── main/           # Electron main process (IPC, LAN scan)
│   │   ├── preload/        # Context bridge (api.scanServers, api.getLocalIps)
│   │   └── renderer/       # React UI (App.jsx, components)
│   └── electron.vite.config.js
│
├── syncbeats-mobile/       # React Native / Expo mobile app
│   ├── app/                # Expo Router screens
│   └── app.json
│
├── portable-server/        # 📦 Turnkey server bundle for friends
│   ├── index.js
│   ├── package.json
│   ├── prisma/
│   ├── public/songs/       # Sample songs included
│   ├── start-server.bat    # Windows (auto-downloads Node if missing)
│   ├── start-server.sh     # macOS / Linux
│   └── start-server.command# macOS double-click launcher
│
├── builds/                 # ⚠️ .gitignored — local build output only
│   ├── syncbeats-desktop-1.0.0-setup.exe
│   └── syncbeats-server-portable.zip
│
└── .github/workflows/
    └── build-mac.yml       # GitHub Actions → macOS DMG
```

---

## Prerequisites

| Tool | Version | Required for |
|------|---------|-------------|
| [Node.js](https://nodejs.org) | v18 or later | Backend, Desktop dev, Portable Server |
| npm | v9+ | All JS installs |
| [Git](https://git-scm.com) | any | Cloning the repo |
| [Expo CLI](https://docs.expo.dev/get-started/installation/) | latest | Mobile development only |
| Android Studio / Xcode | — | Mobile device builds only |

> [!NOTE]
> The **Portable Server** package ships with everything bundled. Users who only want to *host* do **not** need Node.js installed separately — `start-server.bat` will download it automatically on Windows.

---

## Quick Start — Hosting a Session (No Dev Setup Needed)

This is the fastest path for a friend who just wants to host music for the group.

1. **Download** `syncbeats-server-portable.zip` from the [Releases](https://github.com/MayankShekherchaturvedi/SyncBeats/releases) page and extract it.
2. **Drop your MP3 files** into the `public/songs/` folder inside the extracted directory.
3. **Start the server:**
   - **Windows** — double-click `start-server.bat`
   - **macOS / Linux** — open Terminal in the folder and run `sh start-server.sh`
   - **macOS (GUI)** — double-click `start-server.command`
4. The terminal will print something like:
   ```
   🎵 Syncbeats Server running on http://0.0.0.0:5000
   ```
5. Everyone on the same Wi-Fi opens the **Desktop app** or **Mobile app** — they will auto-discover the server within a few seconds.

> [!TIP]
> Keep the terminal window open for as long as you want to host. Closing it stops the server.

---

## Installation & Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/MayankShekherchaturvedi/SyncBeats.git
cd SyncBeats
```

---

### 2. Backend (`syncbeats-backend`)

```bash
cd syncbeats-backend
npm install

# Set up the database
npx prisma generate
npx prisma db push

# Start development server (auto-restarts on file changes)
npm run dev
```

The server starts on **port 5000**. You can confirm it is running by visiting `http://localhost:5000/health`.

**Production start:**
```bash
npm start
```

**Add songs** by dropping MP3/WAV/M4A files into `public/songs/` — the server detects them instantly with no restart needed.

---

### 3. Desktop App (`syncbeats-desktop`)

> Requires the backend to be running (locally or on another machine on the same network).

```bash
cd syncbeats-desktop
npm install

# Start in development mode (opens Electron window + Vite HMR)
npm run dev
```

The app will auto-scan the LAN for a backend server. If none is found, use the **✏️ Edit IP** button to enter the server address manually.

---

### 4. Mobile App (`syncbeats-mobile`)

> Requires [Expo Go](https://expo.dev/go) on your phone, or a connected Android/iOS device for a native build.

```bash
cd syncbeats-mobile
npm install

# Start the Expo dev server
npx expo start
```

Scan the QR code with the **Expo Go** app (iOS) or the Camera app (Android). The app will scan the LAN and connect automatically.

---

## Adding Songs

1. Place any `.mp3`, `.wav`, or `.m4a` file into:
   ```
   syncbeats-backend/public/songs/
   ```
   *(or `portable-server/public/songs/` if using the portable bundle)*

2. The server's folder-watcher (`fs.watch`) detects the new file immediately.

3. The database is updated via Prisma and a **`songs-updated`** Socket.io event is broadcast to every connected client.

4. All open apps refresh their song list automatically — no restart or reload needed.

**Recommended filename format:**
```
Artist Name - Song Title.mp3
```
The backend parses the filename to extract the **artist** and **title** fields automatically.

---

## Building for Distribution

### Windows — Desktop Installer (`.exe`)

Run on a **Windows machine**:

```bash
cd syncbeats-desktop
npm install
npm run build:win
```

Output: `dist/syncbeats-desktop-1.0.0-setup.exe`

The installer is self-contained — users just install it and launch. No Node.js required on their machine.

---

### macOS — DMG (`.dmg`)

**Option A — Build locally on a Mac:**

```bash
cd syncbeats-desktop
chmod +x build-mac.sh
./build-mac.sh
```

Output: `dist/syncbeats-desktop-1.0.0.dmg`

**Option B — GitHub Actions (no Mac required):**

1. Push your changes to `main`.
2. Go to the [Actions tab](https://github.com/MayankShekherchaturvedi/SyncBeats/actions) on GitHub.
3. Select **"Build macOS DMG"** → click **Run workflow**.
4. Download the `syncbeats-dmg` artifact from the completed run.

---

### Linux — AppImage

```bash
cd syncbeats-desktop
npm install
npm run build:linux
```

Output: `dist/syncbeats-desktop-1.0.0.AppImage`

---

### Android — APK

**Option A — EAS Cloud Build (recommended, no Android Studio needed):**

```bash
cd syncbeats-mobile
npm install -g eas-cli
eas login
eas build --platform android
```

Download the APK from the Expo dashboard link printed at the end.

**Option B — Local build (requires Android Studio + SDK):**

```bash
cd syncbeats-mobile
npx expo run:android
```

---

### Portable Server — ZIP Bundle

The `portable-server/` folder is ready to zip and share:

```powershell
# Windows PowerShell — create the zip
Compress-Archive -Path portable-server -DestinationPath builds\syncbeats-server-portable.zip
```

Recipients just extract and double-click `start-server.bat` (Windows) or `start-server.command` (macOS).

---

## How Auto-Discovery Works

You never need to type an IP address. Here is what happens when the app launches:

```
App starts
    │
    ▼
1. Try last saved server URL (localStorage / file)
    │  ✅ works → connect immediately
    │  ❌ fails ↓
    ▼
2. Ask Electron main process to scan (Node http.get)
   → Reads all active network interfaces
   → Probes every IP on each /24 subnet (e.g. 192.168.1.1–254)
   → Batches of 25 concurrent requests, 800 ms timeout each
    │  ✅ found → save URL, connect
    │  ❌ not found ↓
    ▼
3. Renderer fallback scan (fetch API, batches of 15)
    │  ✅ found → save URL, connect
    │  ❌ not found → show "Not Connected" + Edit IP button
```

The whole scan typically completes in **under 1 second** on a typical home network.

---

## API Reference

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{ status: "ok" }` — used by auto-discovery |
| `GET` | `/songs` | Returns JSON array of all songs in the library |
| `GET` | `/songs/:filename` | Streams the audio file (supports Range headers) |

### Socket.io Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `play` | Client → Server → All | `{ songId, position }` | Start/resume playback |
| `pause` | Client → Server → All | `{ position }` | Pause at given position |
| `seek` | Client → Server → All | `{ position }` | Seek to timestamp |
| `next-song` | Client → Server → All | `{ songId }` | Skip to next track |
| `songs-updated` | Server → All | *(none)* | Library changed, re-fetch `/songs` |
| `room-state` | Server → Client | `{ currentSong, isPlaying, position }` | Sent on join to sync late joiners |

---

## Dependencies

### Backend (`syncbeats-backend`)

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.21.2 | HTTP server + file streaming |
| `socket.io` | ^4.8.1 | Real-time event broadcast |
| `@prisma/client` | ^5.22.0 | SQLite ORM |
| `cors` | ^2.8.5 | Cross-origin headers for LAN clients |
| `dotenv` | ^16.4.7 | Environment variables |
| `nodemon` *(dev)* | ^3.1.9 | Auto-restart in development |
| `prisma` *(dev)* | ^5.22.0 | Schema migrations & codegen |

### Desktop (`syncbeats-desktop`)

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^44.7.2 | Desktop shell |
| `electron-vite` | ^6.0.0 | Vite integration for Electron |
| `vite` | ^8.3.4 | Frontend bundler |
| `react` | ^19.3.0 | UI framework |
| `socket.io-client` | ^4.8.4 | Server communication |
| `electron-builder` | ^26.15.3 | Packaging & installers |
| `@electron-toolkit/preload` | — | Context bridge helpers |

### Mobile (`syncbeats-mobile`)

| Package | Version | Purpose |
|---------|---------|---------|
| `expo` | ~58.0.25 | App framework & build toolchain |
| `react-native` | 0.88.1 | Mobile UI |
| `expo-audio` | — | Audio playback |
| `expo-file-system` | — | Local file access |
| `expo-network` | — | Network interface detection |
| `expo-constants` | — | Device / environment info |
| `socket.io-client` | ^4.8.4 | Server communication |
| `react-native-safe-area-context` | — | Safe area insets |

---

## Troubleshooting

### "Server not found" / Auto-discovery fails

- Make sure the backend is **running** (`npm run dev` or `start-server.bat`).
- Confirm all devices are on the **same Wi-Fi or LAN**. Mobile hotspots and guest networks are usually isolated.
- **Windows Firewall** may block port 5000. Allow it:
  ```
  Windows Defender Firewall → Allow an app → Add node.exe → enable Private networks
  ```
  Or via PowerShell (run as Administrator):
  ```powershell
  New-NetFirewallRule -DisplayName "Syncbeats" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
  ```
- Use the **✏️ Edit IP** button in the app and type the host's IP + port manually, e.g. `http://192.168.1.X:5000`. Find the host IP by running `ipconfig` (Windows) or `ifconfig` (macOS/Linux).

### Songs not appearing

- Check that files are in `public/songs/` and have a supported extension (`.mp3`, `.wav`, `.m4a`).
- Restart the backend if the folder watcher has stalled.
- Call `GET /songs` in a browser to confirm the backend sees them.

### `npx prisma db push` fails

- Delete `prisma/dev.db` and run again — it will be recreated from scratch.

### Mobile app can't connect

- Expo Go may not support some native modules. Use `npx expo run:android` or build an APK for full support.
- Check that your phone's firewall or VPN is not blocking LAN traffic.

### macOS DMG won't build on Windows

- This is by design. Use the GitHub Actions workflow (`build-mac.yml`) or build on a physical Mac.

---

## Contributing

Pull requests are welcome! Please open an issue first to discuss major changes.

```bash
# Fork → clone → create feature branch
git checkout -b feat/my-feature

# Make changes, then commit
git commit -m "feat: describe your change"

# Push and open a PR
git push origin feat/my-feature
```

---

## License

MIT © [Mayank Shekher Chaturvedi](https://github.com/MayankShekherchaturvedi)

---

> Built with ❤️ for local music sessions — no cloud, no ads, just vibes.
