import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type Listener = (...args: unknown[]) => void;

const localeCallbacks = new Set<(event: IpcRendererEvent, locale: string) => void>();
ipcRenderer.on('locale:changed', (_event, locale: string) => {
  localeCallbacks.forEach((cb) => cb(_event, locale));
});

const themeCallbacks = new Set<(event: IpcRendererEvent, theme: string) => void>();
ipcRenderer.on('theme:changed', (_event, theme: string) => {
  themeCallbacks.forEach((cb) => cb(_event, theme));
});

const openSettingsCallbacks = new Set<() => void>();
ipcRenderer.on('app:openSettings', () => {
  openSettingsCallbacks.forEach((cb) => cb());
});

const openAboutCallbacks = new Set<() => void>();
ipcRenderer.on('app:openAbout', () => {
  openAboutCallbacks.forEach((cb) => cb());
});

const openExportCallbacks = new Set<() => void>();
ipcRenderer.on('app:openExport', () => {
  openExportCallbacks.forEach((cb) => cb());
});

const openImportCallbacks = new Set<() => void>();
ipcRenderer.on('app:openImport', () => {
  openImportCallbacks.forEach((cb) => cb());
});

contextBridge.exposeInMainWorld('electronAPI', {
  setLocale: (locale: string) => ipcRenderer.invoke('app:setLocale', locale),
  getLocale: () => ipcRenderer.invoke('app:getLocale'),
  setTheme: (theme: string) => ipcRenderer.invoke('app:setTheme', theme),
  getTheme: () => ipcRenderer.invoke('app:getTheme'),
  getUpdateSettings: () => ipcRenderer.invoke('updates:getSettings'),
  setAutoUpdateCheck: (enabled: boolean) => ipcRenderer.invoke('updates:setAutoCheck', enabled),
  getStorageInfo: () => ipcRenderer.invoke('storage:getInfo'),
  clearStorage: () => ipcRenderer.invoke('storage:clear'),
  resetAllSettings: () => ipcRenderer.invoke('storage:resetSettings'),
  deleteAllData: () => ipcRenderer.invoke('storage:deleteAllData'),
  onLocaleChanged: (cb: (event: IpcRendererEvent, locale: string) => void) => {
    localeCallbacks.add(cb);
  },
  offLocaleChanged: (cb: (event: IpcRendererEvent, locale: string) => void) => {
    localeCallbacks.delete(cb);
  },
  onThemeChanged: (cb: (event: IpcRendererEvent, theme: string) => void) => {
    themeCallbacks.add(cb);
  },
  offThemeChanged: (cb: (event: IpcRendererEvent, theme: string) => void) => {
    themeCallbacks.delete(cb);
  },
  onOpenSettings: (cb: () => void) => {
    openSettingsCallbacks.add(cb);
  },
  offOpenSettings: (cb: () => void) => {
    openSettingsCallbacks.delete(cb);
  },
  onOpenAbout: (cb: () => void) => {
    openAboutCallbacks.add(cb);
  },
  offOpenAbout: (cb: () => void) => {
    openAboutCallbacks.delete(cb);
  },
  onOpenExport: (cb: () => void) => {
    openExportCallbacks.add(cb);
  },
  offOpenExport: (cb: () => void) => {
    openExportCallbacks.delete(cb);
  },
  onOpenImport: (cb: () => void) => {
    openImportCallbacks.add(cb);
  },
  offOpenImport: (cb: () => void) => {
    openImportCallbacks.delete(cb);
  },
  backupExport: (options: unknown) => ipcRenderer.invoke('backup:export', options),
  backupImport: (params: unknown) => ipcRenderer.invoke('backup:import', params),
  openFile: (filters?: { name: string; extensions: string[] }[], encoding?: string) =>
    ipcRenderer.invoke('file:open', filters, encoding),
  saveFile: (filePath: string, content: string) => ipcRenderer.invoke('file:save', filePath, content),
  saveFileAs: (defaultName: string, content: string, filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('file:saveAs', defaultName, content, filters),
  confirmOverwrite: (filePath: string) => ipcRenderer.invoke('file:confirmOverwrite', filePath),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getAppIcon: (size?: 'small' | 'normal' | 'large') => ipcRenderer.invoke('app:getIcon', size),
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
  generateCSR: (params: {
    commonName?: string;
    organization?: string;
    organizationalUnit?: string;
    country?: string;
    state?: string;
    locality?: string;
    keySize: number;
  }) => ipcRenderer.invoke('crypto:generateCSR', params),
  generateCA: (params: {
    commonName?: string;
    organization?: string;
    organizationalUnit?: string;
    country?: string;
    state?: string;
    locality?: string;
    keySize: number;
    validityDays: number;
  }) => ipcRenderer.invoke('crypto:generateCA', params),
  generateRSAKeyPair: (params: { keySize: number }) =>
    ipcRenderer.invoke('crypto:generateRSAKeyPair', params),
  generateClientCert: (params: {
    caCertPem: string;
    caKeyPem: string;
    csrPem?: string;
    commonName?: string;
    organization?: string;
    organizationalUnit?: string;
    country?: string;
    state?: string;
    locality?: string;
    keySize: number;
    validityDays: number;
  }) => ipcRenderer.invoke('crypto:generateClientCert', params),
  parseCert: (certPem: string) => ipcRenderer.invoke('crypto:parseCert', certPem),
  getNetworkInfo: () => ipcRenderer.invoke('network:getInfo'),
  pingStart: (host: string, count?: number) => ipcRenderer.send('ping:start', host, count),
  pingStop: () => ipcRenderer.send('ping:stop'),
  onPingData: (cb: (data: string) => void) => {
    const handler = (_e: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('ping:data', handler);
    return handler;
  },
  onPingError: (cb: (err: string) => void) => {
    const handler = (_e: IpcRendererEvent, err: string) => cb(err);
    ipcRenderer.on('ping:error', handler);
    return handler;
  },
  onPingDone: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ping:done', handler);
    return handler;
  },
  offPingListeners: (dataHandler: unknown, errorHandler: unknown, doneHandler: unknown) => {
    if (typeof dataHandler === 'function') ipcRenderer.removeListener('ping:data', dataHandler as Listener);
    if (typeof errorHandler === 'function')
      ipcRenderer.removeListener('ping:error', errorHandler as Listener);
    if (typeof doneHandler === 'function') ipcRenderer.removeListener('ping:done', doneHandler as Listener);
  },
  tracertStart: (host: string, maxHops?: number) => ipcRenderer.send('tracert:start', host, maxHops),
  tracertStop: () => ipcRenderer.send('tracert:stop'),
  onTracertData: (cb: (data: string) => void) => {
    const handler = (_e: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on('tracert:data', handler);
    return handler;
  },
  onTracertError: (cb: (err: string) => void) => {
    const handler = (_e: IpcRendererEvent, err: string) => cb(err);
    ipcRenderer.on('tracert:error', handler);
    return handler;
  },
  onTracertDone: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('tracert:done', handler);
    return handler;
  },
  offTracertListeners: (dataHandler: unknown, errorHandler: unknown, doneHandler: unknown) => {
    if (typeof dataHandler === 'function')
      ipcRenderer.removeListener('tracert:data', dataHandler as Listener);
    if (typeof errorHandler === 'function')
      ipcRenderer.removeListener('tracert:error', errorHandler as Listener);
    if (typeof doneHandler === 'function')
      ipcRenderer.removeListener('tracert:done', doneHandler as Listener);
  },
  convertAndSaveVideo: (webmBase64: string) => ipcRenderer.invoke('video:convertAndSave', webmBase64),

  // Marketplace
  marketplaceListInstalled: () => ipcRenderer.invoke('marketplace:listInstalled'),
  marketplaceInstall: (entry: unknown) => ipcRenderer.invoke('marketplace:install', entry),
  marketplaceUninstall: (id: string) => ipcRenderer.invoke('marketplace:uninstall', id),
  marketplaceSetEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('marketplace:setEnabled', id, enabled),
  marketplaceFetchRegistry: (url: string, options?: { force?: boolean }) =>
    ipcRenderer.invoke('marketplace:fetchRegistry', url, options),

  // Plugin SDK
  pluginHttpRequest: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:httpRequest', pluginId, params),
  pluginStorageGet: (pluginId: string, key: string) => ipcRenderer.invoke('plugin:storageGet', pluginId, key),
  pluginStorageSet: (pluginId: string, key: string, value: unknown) =>
    ipcRenderer.invoke('plugin:storageSet', pluginId, key, value),
  pluginStorageDelete: (pluginId: string, key: string) =>
    ipcRenderer.invoke('plugin:storageDelete', pluginId, key),
  pluginStorageList: (pluginId: string, prefix?: string) =>
    ipcRenderer.invoke('plugin:storageList', pluginId, prefix),
  pluginStorageClear: (pluginId: string) => ipcRenderer.invoke('plugin:storageClear', pluginId),
  pluginFsOpenFileDialog: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:fsOpenFileDialog', pluginId, params),
  pluginFsSaveFileDialog: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:fsSaveFileDialog', pluginId, params),
  pluginFsReadFile: (pluginId: string, fileToken: string, encoding?: string) =>
    ipcRenderer.invoke('plugin:fsReadFile', pluginId, fileToken, encoding),
  pluginFsWriteFile: (pluginId: string, fileToken: string, content: string, encoding?: string) =>
    ipcRenderer.invoke('plugin:fsWriteFile', pluginId, fileToken, content, encoding),
  pluginSystemOpenExternal: (pluginId: string, url: string) =>
    ipcRenderer.invoke('plugin:systemOpenExternal', pluginId, url),
  pluginSystemRevealPath: (pluginId: string, pathToken: string) =>
    ipcRenderer.invoke('plugin:systemRevealPath', pluginId, pathToken),
  pluginSystemOpenPath: (pluginId: string, pathToken: string) =>
    ipcRenderer.invoke('plugin:systemOpenPath', pluginId, pathToken),
  pluginSystemNotify: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:systemNotify', pluginId, params),
  pluginSystemGetInfo: (pluginId: string) => ipcRenderer.invoke('plugin:systemGetInfo', pluginId),
  pluginSystemGetEnv: (pluginId: string, keys: string[]) =>
    ipcRenderer.invoke('plugin:systemGetEnv', pluginId, keys),
  pluginLog: (pluginId: string, params: unknown) => ipcRenderer.invoke('plugin:log', pluginId, params),
  pluginSocketServerStart: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:socketServerStart', pluginId, params),
  pluginSocketServerStop: (pluginId: string) => ipcRenderer.invoke('plugin:socketServerStop', pluginId),
  pluginSocketServerStatus: (pluginId: string) => ipcRenderer.invoke('plugin:socketServerStatus', pluginId),
  pluginSocketServerSend: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:socketServerSend', pluginId, params),
  pluginSocketServerKick: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:socketServerKick', pluginId, params),
  pluginSocketClientConnect: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:socketClientConnect', pluginId, params),
  pluginSocketClientDisconnect: (pluginId: string) =>
    ipcRenderer.invoke('plugin:socketClientDisconnect', pluginId),
  pluginSocketClientStatus: (pluginId: string) => ipcRenderer.invoke('plugin:socketClientStatus', pluginId),
  pluginSocketClientSend: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:socketClientSend', pluginId, params),
  onPluginSocketEvent: (cb: (pluginId: string, ev: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, pid: string, ev: unknown) => cb(pid, ev);
    ipcRenderer.on('plugin:socketEvent', handler);
    return handler;
  },
  offPluginSocketEvent: (handler: unknown) => {
    if (typeof handler === 'function') ipcRenderer.removeListener('plugin:socketEvent', handler as Listener);
  },
  pluginSshConnect: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshConnect', pluginId, params),
  pluginSshDisconnect: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshDisconnect', pluginId, params),
  pluginSshCloseTerminal: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshCloseTerminal', pluginId, params),
  pluginSshListSessions: (pluginId: string) => ipcRenderer.invoke('plugin:sshListSessions', pluginId),
  pluginSshWrite: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshWrite', pluginId, params),
  pluginSshResize: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshResize', pluginId, params),
  pluginSshRespondKeyboard: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshRespondKeyboard', pluginId, params),
  pluginSshSftpRealpath: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshSftpRealpath', pluginId, params),
  pluginSshSftpList: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshSftpList', pluginId, params),
  pluginSshSftpReadFile: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshSftpReadFile', pluginId, params),
  pluginSshSftpWriteFile: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshSftpWriteFile', pluginId, params),
  pluginSshSftpMkdir: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshSftpMkdir', pluginId, params),
  pluginSshSftpDelete: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshSftpDelete', pluginId, params),
  pluginSshSftpRename: (pluginId: string, params: unknown) =>
    ipcRenderer.invoke('plugin:sshSftpRename', pluginId, params),
  onPluginSshEvent: (cb: (pluginId: string, ev: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, pid: string, ev: unknown) => cb(pid, ev);
    ipcRenderer.on('plugin:sshEvent', handler);
    return handler;
  },
  offPluginSshEvent: (handler: unknown) => {
    if (typeof handler === 'function') ipcRenderer.removeListener('plugin:sshEvent', handler as Listener);
  },
  httpRequest: (params: unknown) => ipcRenderer.invoke('http:request', params),
  mqttConnect: (params: unknown) => ipcRenderer.invoke('mqtt:connect', params),
  mqttDisconnect: (id: string) => ipcRenderer.invoke('mqtt:disconnect', id),
  mqttSubscribe: (id: string, topic: string, qos: number) =>
    ipcRenderer.invoke('mqtt:subscribe', id, topic, qos),
  mqttUnsubscribe: (id: string, topic: string) => ipcRenderer.invoke('mqtt:unsubscribe', id, topic),
  mqttPublish: (id: string, topic: string, payload: string, qos: number, retain: boolean) =>
    ipcRenderer.invoke('mqtt:publish', id, topic, payload, qos, retain),
  onMqttEvent: (cb: (id: string, event: string, data?: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, id: string, ev: string, data?: unknown) => cb(id, ev, data);
    ipcRenderer.on('mqtt:event', handler);
    return handler;
  },
  offMqttEvent: (handler: unknown) => {
    if (typeof handler === 'function') ipcRenderer.removeListener('mqtt:event', handler as Listener);
  },

  wsServerStart: (params: unknown) => ipcRenderer.invoke('wsServer:start', params),
  wsServerStop: () => ipcRenderer.invoke('wsServer:stop'),
  wsServerStatus: () => ipcRenderer.invoke('wsServer:status'),
  wsServerSend: (params: unknown) => ipcRenderer.invoke('wsServer:send', params),
  wsServerKick: (params: unknown) => ipcRenderer.invoke('wsServer:kick', params),
  wsServerStressStart: (params: unknown) => ipcRenderer.invoke('wsServer:stressStart', params),
  wsServerStressStop: () => ipcRenderer.invoke('wsServer:stressStop'),
  onWsServerEvent: (cb: (ev: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, ev: unknown) => cb(ev);
    ipcRenderer.on('wsServer:event', handler);
    return handler;
  },
  offWsServerEvent: (handler: unknown) => {
    if (typeof handler === 'function') ipcRenderer.removeListener('wsServer:event', handler as Listener);
  },
});
