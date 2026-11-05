'use strict';
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const { Monitor } = require('./monitor.cjs');
const { createServer } = require('./server.cjs');
const { OverlayManager } = require('./overlays.cjs');
const { BrowserChat, ChatController } = require('./browser-chat.cjs');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();
let window, service, monitor, overlays;
app.on('second-instance', () => { window?.show(); window?.focus(); });
app.whenReady().then(async () => {
  const primary = new Monitor({ resolveChannel: async channel => {
    const response = await session.defaultSession.fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'Channel not found.' : `Kick returned ${response.status}. Its public chat access may be unavailable. Try again later.`);
    let data; try { data = await response.json(); } catch { throw new Error('Kick returned a challenge instead of channel data. Try again later.'); }
    return data.chatroom?.id;
  } });
  const browser = new BrowserChat({ createWindow: () => {
    const chat = new BrowserWindow({ width:460, height:780, title:'Kick chat — keep open for notifications', autoHideMenuBar:true, webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false} });
    const allowed = url => { try { const u = new URL(url); return u.protocol === 'https:' && ['kick.com','www.kick.com'].includes(u.hostname); } catch { return false; } };
    chat.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    chat.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
    chat.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
    return chat;
  }});
  monitor = new ChatController(primary,browser,{preferBrowser:true});
  overlays = new OverlayManager({dataDir:path.join(app.getPath('userData'),'data'),createWindow:source=>{
    const partition=`persist:pinger-overlay-${source.id}`;
    session.fromPartition(partition).setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    const overlay = new BrowserWindow({width:960,height:540,useContentSize:true,minWidth:360,minHeight:240,show:false,title:`Powiadomienia — ${source.name}`,autoHideMenuBar:true,backgroundColor:'#101312',webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const allowed=url=>{try{return new URL(url).protocol==='https:';}catch{return false;}};
    overlay.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
    overlay.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
    overlay.webContents.on('page-title-updated',event=>event.preventDefault());
    overlay.webContents.setZoomFactor(0.5);
    return overlay;
  }});
  try{await overlays.init();}catch(error){overlays.loadError=error.message;}
  service = await createServer({ monitor, overlays, dataDir: path.join(app.getPath('userData'), 'data'), port: 0 });
  window = new BrowserWindow({ width: 1160, height: 850, minWidth: 780, minHeight: 650, backgroundColor: '#101312', title: 'Chat Pinger', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== service.origin) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('closed', () => { monitor.stop(); overlays.closeAll(); app.quit(); });
  await window.loadURL(service.url);
  if(!overlays.loadError)overlays.autoStart();
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { monitor?.stop(); overlays?.closeAll(); void service?.close(); });
