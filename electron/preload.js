const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer (browser window)
contextBridge.exposeInMainWorld('electronAPI', {
    // Discord RPC
    updateDiscordPresence: (data) => ipcRenderer.invoke('discord:updatePresence', data),
    getDiscordStatus: () => ipcRenderer.invoke('discord:getStatus'),
    
    // App info
    isElectron: true,
    platform: process.platform,
    version: require('../package.json').version
});
