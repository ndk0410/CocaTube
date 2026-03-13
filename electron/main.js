const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const DiscordRPC = require('discord-rpc');

// ===== DISCORD RPC =====
const DISCORD_CLIENT_ID = '1481699680239751192';
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
let serverProcess = null;

function startEmbeddedServer() {
    try {
        // Import and run the server directly
        require(path.join(__dirname, '..', 'server.js'));
        console.log('[ELECTRON] Embedded server started');
    } catch (err) {
        console.error('[ELECTRON] Failed to start server:', err.message);
    }
}

// ===== ELECTRON WINDOW =====
let mainWindow = null;
let tray = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 400,
        minHeight: 600,
        title: 'CocaTube',
        icon: path.join(__dirname, '..', 'logo.png'),
        autoHideMenuBar: true,
        backgroundColor: '#0a0a0a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    // Load the local server
    mainWindow.loadURL('http://localhost:3000');

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
    const iconPath = path.join(__dirname, '..', 'logo.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Mở CocaTube', click: () => mainWindow && mainWindow.show() },
        { type: 'separator' },
        { label: 'Thoát', click: () => { app.isQuitting = true; app.quit(); } }
    ]);

    tray.setToolTip('CocaTube Music');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow && mainWindow.show());
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

// ===== APP LIFECYCLE =====
app.whenReady().then(() => {
    startEmbeddedServer();
    initDiscordRPC();

    // Wait for server to be ready
    setTimeout(() => {
        createWindow();
        createTray();
    }, 2000);
});

app.on('window-all-closed', () => {
    // Don't quit on macOS
    if (process.platform !== 'darwin') {
        // Keep running in tray
    }
});

app.on('activate', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    if (rpcClient) {
        try { rpcClient.destroy(); } catch (e) {}
    }
});
