const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sessionRoomsDesktop', Object.freeze({
  chooseDirectory: options => ipcRenderer.invoke('session-rooms:choose-directory', options)
}));
