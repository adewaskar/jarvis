const { app, BrowserWindow, session, shell, dialog, Menu } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const APP_ROOT = app.getAppPath()
const DIST_ROOT = path.join(APP_ROOT, 'dist')
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm',
}
let staticServer
let mainWindow
let appOrigin

function serveFile(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    return res.end()
  }
  let pathname
  try { pathname = decodeURIComponent(new URL(req.url || '/', appOrigin).pathname) }
  catch { res.writeHead(400); return res.end('Bad request') }
  const relativePath = pathname.replace(/^[/\\]+/, '')
  let filePath = path.resolve(DIST_ROOT, relativePath || 'index.html')
  if (filePath !== DIST_ROOT && !filePath.startsWith(DIST_ROOT + path.sep)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  let info
  try {
    info = fs.statSync(filePath)
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html')
    info = fs.statSync(filePath)
  } catch {
    if (path.extname(relativePath)) { res.writeHead(404); return res.end('Not found') }
    filePath = path.join(DIST_ROOT, 'index.html')
    try { info = fs.statSync(filePath) } catch {
      res.writeHead(500)
      return res.end('Production build is missing. Reinstall JARVIS.')
    }
  }
  if (!info.isFile()) { res.writeHead(404); return res.end('Not found') }
  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size,
    'x-content-type-options': 'nosniff',
    'cache-control': path.basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=3600',
  })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(filePath).pipe(res)
}

function listenStaticServer() {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer(serveFile)
    let port = 4173
    const tryPort = () => {
      if (port > 4199) return reject(new Error('All local app ports 4173-4199 are busy. Close another JARVIS instance and retry.'))
      staticServer.once('error', (error) => {
        if (error.code === 'EADDRINUSE') { port += 1; tryPort() }
        else reject(error)
      })
      staticServer.listen(port, '127.0.0.1', () => {
        appOrigin = 'http://127.0.0.1:' + port
        resolve(port)
      })
    }
    tryPort()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 980, minWidth: 1100, minHeight: 700,
    backgroundColor: '#01060c', show: false, autoHideMenuBar: true,
    title: 'J.A.R.V.I.S.',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:') void shell.openExternal(url)
    } catch {}
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin + '/')) event.preventDefault()
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
  return mainWindow.loadURL(appOrigin)
}

function openPowerShellHelper(fileName) {
  const helper = path.join(process.resourcesPath, fileName)
  if (!fs.existsSync(helper)) {
    dialog.showErrorBox('J.A.R.V.I.S.', 'O utilitário não foi incluído nesta instalação. Reinstale o JARVIS.')
    return
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', helper], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
}

function installApplicationMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'J.A.R.V.I.S.',
      submenu: [
        { label: 'Configurar provedor de IA...', click: () => openPowerShellHelper('configure-provider.ps1') },
        { label: 'Configurar geração de mídia...', click: () => openPowerShellHelper('configure-media.ps1') },
        { label: 'Instalar Ollama local...', click: () => openPowerShellHelper('install-ollama.ps1') },
        { type: 'separator' },
        { label: 'Abrir pasta de trabalho', click: () => shell.openPath(process.env.JARVIS_WORKSPACE) },
        { label: 'Documentação', click: () => shell.openPath(path.join(process.resourcesPath, 'WINDOWS.md')) },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])
  Menu.setApplicationMenu(menu)
}

async function boot() {
  if (!fs.existsSync(path.join(DIST_ROOT, 'index.html'))) {
    throw new Error('The built JARVIS interface is missing. Reinstall the Windows application.')
  }
  const port = await listenStaticServer()
  process.env.JARVIS_BRIDGE_HOST = '127.0.0.1'
  process.env.JARVIS_BRIDGE_PORT = process.env.JARVIS_BRIDGE_PORT || '8787'
  process.env.JARVIS_ALLOWED_ORIGINS = appOrigin + ',http://localhost:' + port
  process.env.JARVIS_WORKSPACE = process.env.JARVIS_WORKSPACE || path.join(app.getPath('documents'), 'JARVIS Workspace')
  fs.mkdirSync(process.env.JARVIS_WORKSPACE, { recursive: true })

  const currentSession = session.defaultSession
  const permittedOrigin = appOrigin
  currentSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    let origin = ''
    try { origin = details.requestingUrl ? new URL(details.requestingUrl).origin : '' } catch {}
    callback(permission === 'media' && origin === permittedOrigin)
  })
  currentSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === 'media' && requestingOrigin === permittedOrigin
  })

  // Import after the loopback origin and port policy have been set.
  await import('../bridge/server.mjs')
  await createWindow()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('com.jarvis.desktop')
    installApplicationMenu()
    return boot()
  }).catch((error) => {
    console.error('[JARVIS desktop] startup failed:', error)
    dialog.showErrorBox('J.A.R.V.I.S. could not start', String(error?.message || error))
    app.quit()
  })
}
app.on('before-quit', () => { if (staticServer) staticServer.close() })
app.on('window-all-closed', () => app.quit())
