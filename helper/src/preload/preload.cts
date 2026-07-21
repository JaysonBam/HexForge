const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('hexForgeFileHelper', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  chooseWorkflowFolder: (workflowFolder: string) => ipcRenderer.invoke('settings:choose-workflow-folder', workflowFolder),
  chooseApplication: (application: 'bambu' | 'cura') => ipcRenderer.invoke('settings:choose-application', application),
  createShortcuts: () => ipcRenderer.invoke('settings:create-shortcuts'),
  openRoot: () => ipcRenderer.invoke('settings:open-root'),
  openLogs: () => ipcRenderer.invoke('settings:open-logs')
});
