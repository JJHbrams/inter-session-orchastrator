const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sessionRoomsDesktop', Object.freeze({
  chooseDirectory: options => ipcRenderer.invoke('session-rooms:choose-directory', options),
  installUpdate: payload => ipcRenderer.invoke('session-rooms:install-update', payload)
}));
