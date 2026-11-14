import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import os from 'os'
import http from 'http'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false // Permits LAN communication with host server from file:// origin in packaged builds
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Helper to probe a single candidate server on /health with a fast timeout
function probeServer(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      const req = http.get(
        {
          hostname: u.hostname,
          port: u.port || 5000,
          path: '/health',
          timeout: timeoutMs
        },
        (res) => {
          if (res.statusCode === 200) {
            let data = ''
            res.on('data', (chunk) => {
              data += chunk
            })
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data)
                if (parsed.status === 'ok') {
                  resolve(url)
                  return
                }
              } catch {
                // not valid json
              }
              resolve(null)
            })
          } else {
            resolve(null)
          }
        }
      )
      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
    } catch {
      resolve(null)
    }
  })
}

// Subnet scanner that scans localhost and all active IPv4 /24 subnets in parallel batches
async function scanForBackendServer() {
  const candidates = ['http://localhost:5000']
  const interfaces = os.networkInterfaces()
  const prefixes = new Set()

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.')
        if (parts.length === 4) {
          prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`)
        }
      }
    }
  }

  for (const prefix of prefixes) {
    for (let i = 1; i <= 254; i++) {
      candidates.push(`http://${prefix}.${i}:5000`)
    }
  }

  // Probe localhost first
  const localRes = await probeServer('http://localhost:5000', 400)
  if (localRes) return localRes

  // Probe LAN candidates in parallel batches of 25
  const BATCH_SIZE = 25
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map((url) => probeServer(url)))
    const found = results.find(Boolean)
    if (found) return found
  }

  return null
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers for local IP discovery and fast Node-based LAN subnet scanning
  ipcMain.handle('get-local-ips', () => {
    const interfaces = os.networkInterfaces()
    const ips = []
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address)
        }
      }
    }
    return ips
  })

  ipcMain.handle('scan-servers', async () => {
    return await scanForBackendServer()
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
