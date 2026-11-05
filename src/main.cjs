'use strict';
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const { Monitor } = require('./monitor.cjs');
const { createServer } = require('./server.cjs');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();
let window, service, monitor;
app.on('second-instance', () => { window?.show(); window?.focus(); });
app.whenReady().then(async () => {
  monitor = new Monitor({ resolveChannel: async channel => {
    const response = await session.defaultSession.fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'Channel not found.' : `Kick returned ${response.status}. Its public chat access may be unavailable. Try again later.`);
    let data; try { data = await response.json(); } catch { throw new Error('Kick returned a challenge instead of channel data. Try again later.'); }
    return data.chatroom?.id;
  } });
  service = await createServer({ monitor, dataDir: path.join(app.getPath('userData'), 'data'), port: 0 });
  window = new BrowserWindow({ width: 1160, height: 850, minWidth: 780, minHeight: 650, backgroundColor: '#101312', title: 'Chat Pinger', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== service.origin) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await window.loadURL(service.url);
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { monitor?.stop(); void service?.close(); });
