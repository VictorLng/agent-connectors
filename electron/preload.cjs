const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentDesk', {
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  chooseDirectory: (defaultPath) => ipcRenderer.invoke('directory:choose', defaultPath),
  startRuntime: (request) => ipcRenderer.invoke('runtime:start', request),
  attachTerminal: (runtimeId) => ipcRenderer.invoke('terminal:attach', runtimeId),
  writeTerminal: (runtimeId, data) => ipcRenderer.send('terminal:write', { runtimeId, data }),
  resizeTerminal: (runtimeId, cols, rows) => ipcRenderer.send('terminal:resize', { runtimeId, cols, rows }),
  stopRuntime: (runtimeId) => ipcRenderer.invoke('runtime:stop', runtimeId),
  listRuntimes: () => ipcRenderer.invoke('runtime:list'),
  getProjectChanges: (runtimeId) => ipcRenderer.invoke('project:changes', runtimeId),
  openInPhpStorm: (runtimeId, relativePath) => ipcRenderer.invoke('project:open-phpstorm', { runtimeId, relativePath }),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onRuntimeExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('runtime:exit', listener);
    return () => ipcRenderer.removeListener('runtime:exit', listener);
  },
});
