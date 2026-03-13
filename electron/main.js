const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const http = require('http');
const DiscordRPC = require('discord-rpc');

// ===== CONSTANTS =====
const DISCORD_CLIENT_ID = '1481699680239751192';
const LOCAL_URL = 'http://localhost:3000';
const VERCEL_URL = 'https://coca-tube.vercel.app'; // Fallback to web version
const SERVER_PATH = path.join(__dirname, '..', 'server.js');

// ===== DISCORD RPC =====
let rpcClient = null;
let rpcReady = false;

function initDiscordRPC() {
    if (rpcClient) return;
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

    rpcClient.on('ready', () => {
        console.log('[DISCORD] Connected!');
        rpcReady = true;
    });

    rpcClient.on('disconnected', () => {
        console.warn('[DISCORD] Disconnected.');
        rpcReady = false;
        rpcClient = null;
        setTimeout(initDiscordRPC, 15000);
    });

    rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
        console.warn(`[DISCORD] Login failed: ${err.message}`);
        rpcClient = null;
        rpcReady = false;
        setTimeout(initDiscordRPC, 30000);
    });
}

// ===== EMBEDDED SERVER =====
function startEmbeddedServer() {
    try {
        require(SERVER_PATH);
        console.log('[ELECTRON] Embedded server started');
        return true;
    } catch (err) {
        console.error('[ELECTRON] Failed to start server:', err.message);
        return false;
    }
}

// Check if local server is responding
function waitForServer(url, maxRetries = 15) {
    return new Promise((resolve) => {
        let retries = 0;
        const check = () => {
            http.get(url, (res) => {
                resolve(true);
            }).on('error', () => {
                retries++;
                if (retries >= maxRetries) {
                    resolve(false);
                } else {
                    setTimeout(check, 500);
                }
            });
        };
        check();
    });
}

// ===== ELECTRON WINDOW =====
let mainWindow = null;
let tray = null;

function createWindow(loadUrl) {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 400,
        minHeight: 600,
        title: 'CocaTube',
        icon: path.join(__dirname, '..', 'logo.png'),
        autoHideMenuBar: true,
        backgroundColor: '#0a0a0a',
        show: false, // Don't show until ready
        titleBarStyle: 'default',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
        }
    });

    // Load the URL
    mainWindow.loadURL(loadUrl);

    // Show window when ready (no white flash)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Open external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) shell.openExternal(url);
        return { action: 'deny' };
    });

    // Minimize to tray instead of closing
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    try {
        const iconPath = path.join(__dirname, '..', 'logo.png');
        const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
        tray = new Tray(icon);

        const contextMenu = Menu.buildFromTemplate([
            { label: '🎵 Mở CocaTube', click: () => mainWindow && mainWindow.show() },
            { type: 'separator' },
            { label: '🌐 Mở bản Web', click: () => shell.openExternal(VERCEL_URL) },
            { type: 'separator' },
            { label: '❌ Thoát', click: () => { app.isQuitting = true; app.quit(); } }
        ]);

        tray.setToolTip('CocaTube Music');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
    } catch (e) {
        console.warn('[ELECTRON] Tray icon error:', e.message);
    }
}

// ===== IPC HANDLERS (Discord RPC from renderer) =====
ipcMain.handle('discord:updatePresence', async (_, data) => {
    if (!rpcReady || !rpcClient) return { error: 'RPC not ready' };

    try {
        if (data.type === 'clear') {
            await rpcClient.clearActivity();
        } else {
            await rpcClient.setActivity({
                details: data.details || 'Đang nghe nhạc',
                state: data.state || 'CocaTube',
                largeImageKey: data.largeImageKey || 'logo',
                largeImageText: 'CocaTube Music',
                smallImageKey: 'play',
                smallImageText: 'Listening',
                startTimestamp: data.startTimestamp ? parseInt(data.startTimestamp) : undefined,
                endTimestamp: data.endTimestamp ? parseInt(data.endTimestamp) : undefined,
                instance: false,
            });
        }
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('discord:getStatus', () => {
    return { ready: rpcReady };
});

// ===== APP LIFECYCLE =====
app.whenReady().then(async () => {
    // Start embedded server
    startEmbeddedServer();
    initDiscordRPC();

    // Wait for server to be ready
    console.log('[ELECTRON] Waiting for server...');
    const serverReady = await waitForServer(LOCAL_URL);

    let loadUrl;
    if (serverReady) {
        console.log('[ELECTRON] Local server ready!');
        loadUrl = LOCAL_URL;
    } else {
        console.warn('[ELECTRON] Local server not available. Loading web version...');
        loadUrl = VERCEL_URL;
    }

    createWindow(loadUrl);
    createTray();
});

app.on('window-all-closed', () => {
    // Keep running in tray on all platforms
});

app.on('activate', () => {
    if (!mainWindow) createWindow(LOCAL_URL);
    else mainWindow.show();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    if (rpcClient) {
        try { rpcClient.destroy(); } catch (e) {}
    }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}
