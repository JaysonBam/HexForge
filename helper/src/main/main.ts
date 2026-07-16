import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_HELPER_VERSION } from '../../../shared/localHelperProtocol.js';
import { LocalApiServer } from './apiServer.js';
import { ConfigStore, normalizeAllowedOrigin, type HelperConfig } from './config.js';
import { CopyOperationManager } from './copyOperations.js';
import { RotatingLogger } from './logger.js';
import { OpaqueRegistry } from './registry.js';
import { detectSlicerPaths, openSupportedFile } from './windowsIntegration.js';

app.setName('PrintingManagerHelper');
const appDataOverride = process.env.PRINTING_MANAGER_HELPER_APPDATA;
if (appDataOverride) app.setPath('userData', path.join(appDataOverride, 'PrintingManagerHelper'));
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let apiServer: LocalApiServer | null = null;
let configStore: ConfigStore;
let logger: RotatingLogger;
let copyOperations: CopyOperationManager;
let isQuitting = false;

const rendererPath = (filename: string) => fileURLToPath(new URL(`../renderer/${filename}`, import.meta.url));
const preloadPath = fileURLToPath(new URL('../preload/preload.cjs', import.meta.url));
const portableExecutablePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const publicSettings = (config: HelperConfig) => ({
  schemaVersion: config.schemaVersion,
  rootProjectFolder: config.rootProjectFolder,
  port: config.port,
  allowedOrigins: config.allowedOrigins,
  bambuStudioPath: config.bambuStudioPath,
  curaPath: config.curaPath,
  startWithWindows: config.startWithWindows,
  defaultApplications: config.defaultApplications,
  version: LOCAL_HELPER_VERSION
});

const showSettings = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 860,
    height: 820,
    minWidth: 680,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Printing Manager Helper',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  void settingsWindow.loadFile(rendererPath('settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWindow?.hide();
    }
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
};

const applyStartupPreference = (enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: portableExecutablePath(),
    args: ['--background']
  });
};

const restartApi = async () => {
  await apiServer?.stop();
  apiServer = new LocalApiServer({
    configStore,
    registry: new OpaqueRegistry(),
    logger,
    copyOperations,
    openFile: openSupportedFile,
    openFolder: async (folderPath) => {
      const error = await shell.openPath(folderPath);
      if (error) throw new Error(error);
    },
    openSettings: showSettings
  });
  try {
    await apiServer.start();
  } catch (error) {
    await logger.error('api_start_failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    showSettings();
    const errorOptions: Electron.MessageBoxOptions = {
      type: 'error',
      title: 'Local API could not start',
      message: 'Printing Manager Helper could not start its local connection.',
      detail: error instanceof Error ? error.message : 'Check the configured port and try again.'
    };
    void (settingsWindow ? dialog.showMessageBox(settingsWindow, errorOptions) : dialog.showMessageBox(errorOptions));
  }
};

const showConnectionStatus = async () => {
  const config = configStore.get();
  let rootStatus = 'Not configured';
  if (config.rootProjectFolder) {
    rootStatus = await access(config.rootProjectFolder).then(() => 'Available').catch(() => 'Unavailable');
  }
  await dialog.showMessageBox({
    type: rootStatus === 'Available' ? 'info' : 'warning',
    title: 'Printing Manager Helper status',
    message: rootStatus === 'Available' ? 'Files are ready to connect.' : 'Local files need attention.',
    detail: `Version: ${LOCAL_HELPER_VERSION}\nLocal API: http://127.0.0.1:${config.port}/v1\nProjects root: ${rootStatus}\nAllowed origins: ${config.allowedOrigins.length}`
  });
};

const chooseRoot = async (): Promise<string | null> => {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose Printing Manager projects root',
    defaultPath: configStore.get().rootProjectFolder ?? undefined,
    properties: ['openDirectory', 'createDirectory']
  };
  const result = settingsWindow ? await dialog.showOpenDialog(settingsWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
};

const rebuildTrayMenu = () => {
  if (!tray) return;
  const config = configStore.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show connection status', click: () => void showConnectionStatus() },
    { type: 'separator' },
    { label: 'Change projects root folder', click: async () => {
      const selected = await chooseRoot();
      if (selected) {
        await configStore.update({ rootProjectFolder: selected });
        rebuildTrayMenu();
      }
    } },
    { label: 'Open projects root folder', enabled: Boolean(config.rootProjectFolder), click: () => {
      if (config.rootProjectFolder) void shell.openPath(config.rootProjectFolder);
    } },
    { label: 'Open settings', click: showSettings },
    { label: 'Open logs', click: () => void shell.openPath(logger.directory) },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: config.startWithWindows, click: async (item) => {
      await configStore.update({ startWithWindows: item.checked });
      applyStartupPreference(item.checked);
      rebuildTrayMenu();
    } },
    { label: 'Restart helper', click: () => { app.relaunch({ execPath: portableExecutablePath() }); isQuitting = true; app.exit(0); } },
    { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
  ]));
};

const createShortcuts = async () => {
  try {
    const executable = portableExecutablePath();
    const startMenuDirectory = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    await mkdir(startMenuDirectory, { recursive: true });
    const details = { target: executable, cwd: path.dirname(executable), description: 'Printing Manager local file helper' };
    const desktopOk = shell.writeShortcutLink(path.join(app.getPath('desktop'), 'Printing Manager Helper.lnk'), 'create', details);
    const menuOk = shell.writeShortcutLink(path.join(startMenuDirectory, 'Printing Manager Helper.lnk'), 'create', details);
    return { ok: desktopOk && menuOk, message: desktopOk && menuOk ? 'Desktop and Start menu shortcuts created.' : 'One or more shortcuts could not be created.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Shortcuts could not be created.' };
  }
};

const registerIpc = () => {
  ipcMain.handle('settings:get', () => {
    return publicSettings(configStore.get());
  });
  ipcMain.handle('settings:choose-root', chooseRoot);
  ipcMain.handle('settings:choose-application', async (_event, application: 'bambu' | 'cura') => {
    if (!['bambu', 'cura'].includes(application)) return null;
    const options: Electron.OpenDialogOptions = {
      title: application === 'bambu' ? 'Choose Bambu Studio' : 'Choose UltiMaker Cura',
      properties: ['openFile'],
      filters: [{ name: 'Windows application', extensions: ['exe'] }]
    };
    const result = settingsWindow ? await dialog.showOpenDialog(settingsWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('settings:save', async (_event, input: Partial<HelperConfig>) => {
    const previous = configStore.get();
    const allowedOrigins = Array.isArray(input.allowedOrigins)
      ? input.allowedOrigins.map(normalizeAllowedOrigin).filter((origin): origin is string => Boolean(origin))
      : previous.allowedOrigins;
    if (!allowedOrigins.length) throw new Error('Add at least one valid allowed origin.');
    const next = await configStore.update({
      rootProjectFolder: typeof input.rootProjectFolder === 'string' ? input.rootProjectFolder : null,
      port: Number(input.port),
      allowedOrigins,
      bambuStudioPath: typeof input.bambuStudioPath === 'string' ? input.bambuStudioPath : null,
      curaPath: typeof input.curaPath === 'string' ? input.curaPath : null,
      startWithWindows: Boolean(input.startWithWindows),
      defaultApplications: { ...previous.defaultApplications, ...(input.defaultApplications ?? {}) }
    });
    applyStartupPreference(next.startWithWindows);
    rebuildTrayMenu();
    if (next.port !== previous.port || next.allowedOrigins.join('|') !== previous.allowedOrigins.join('|')) await restartApi();
    return publicSettings(next);
  });
  ipcMain.handle('settings:create-shortcuts', createShortcuts);
  ipcMain.handle('settings:open-root', () => {
    const root = configStore.get().rootProjectFolder;
    if (root) return shell.openPath(root);
    return undefined;
  });
  ipcMain.handle('settings:open-logs', () => shell.openPath(logger.directory));
};

app.on('second-instance', () => showSettings());
app.on('window-all-closed', () => { /* Tray application intentionally remains active. */ });
app.on('before-quit', () => {
  isQuitting = true;
  void apiServer?.stop();
});

void app.whenReady().then(async () => {
  const appDataDirectory = appDataOverride || app.getPath('appData');
  configStore = new ConfigStore(appDataDirectory);
  logger = new RotatingLogger(appDataDirectory);
  await logger.initialize();
  let config = await configStore.load();
  const detected = await detectSlicerPaths();
  if ((!config.bambuStudioPath && detected.bambuStudioPath) || (!config.curaPath && detected.curaPath)) {
    config = await configStore.update({
      bambuStudioPath: config.bambuStudioPath ?? detected.bambuStudioPath,
      curaPath: config.curaPath ?? detected.curaPath
    });
  }
  applyStartupPreference(config.startWithWindows);
  copyOperations = new CopyOperationManager(configStore, () => settingsWindow);
  registerIpc();
  await restartApi();

  const icon = nativeImage.createFromPath(path.join(process.resourcesPath, 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Printing Manager Helper');
  tray.on('double-click', showSettings);
  rebuildTrayMenu();

  if (!config.rootProjectFolder || !process.argv.includes('--background')) showSettings();
  await logger.info('helper_ready', { version: LOCAL_HELPER_VERSION, configured: Boolean(config.rootProjectFolder) });
});
