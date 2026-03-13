const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer (browser window)
contextBridge.exposeInMainWorld('electronAPI', {
    updateDiscordPresence: (data) => ipcRenderer.invoke('discord:updatePresence', data),
    isElectron: true
});
