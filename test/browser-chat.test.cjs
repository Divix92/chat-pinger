const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {BrowserChat,ChatController}=require('../src/browser-chat.cjs');const {Monitor}=require('../src/monitor.cjs');
test('browser fallback delivers new entries and closes when monitoring stops',async()=>{
 const window=new EventEmitter();let destroyed=false,calls=0;
 window.isDestroyed=()=>destroyed;window.close=()=>{destroyed=true;window.emit('closed');};window.loadURL=async url=>{window.url=url;};
 window.webContents={getURL:()=>window.url,executeJavaScript:async()=>({ready:true,messages:++calls===1?[{username:'viewer',content:'hello'}]:[]})};
 const browser=new BrowserChat({createWindow:()=>window,intervalMs:5});const messages=[];browser.on('chat',m=>messages.push(m));
 await browser.connect('https://kick.com/test');await new Promise(r=>setTimeout(r,20));assert.equal(browser.state.status,'connected');assert.match(window.url,/popout\/test\/chat/);assert.equal(messages.length,1);assert.equal(browser.state.count,1);
 browser.stop();assert.equal(destroyed,true);assert.equal(browser.state.status,'idle');
});
test('switching connector discards old transport events and stops the previous backend',async()=>{
 const primary=new Monitor({resolveChannel:async()=>undefined});const browser=new EventEmitter();browser.state={status:'idle'};let stops=0;browser.stop=()=>stops++;browser.connect=async()=>{browser.state={status:'connected',count:0};browser.emit('status',browser.state);};
 const controller=new ChatController(primary,browser);let chats=0;controller.on('chat',()=>chats++);await controller.connectBrowser('test');primary.emit('chat',{});browser.emit('chat',{});assert.equal(chats,1);assert.equal(controller.state.status,'connected');await controller.connect('test');assert.equal(stops,1);controller.stop();
});
test('page-owned socket events work when no known chat DOM is present',async()=>{
 const window=new EventEmitter();let destroyed=false,callbacks;window.isDestroyed=()=>destroyed;window.close=()=>{destroyed=true;window.emit('closed');};window.loadURL=async url=>window.url=url;
 window.webContents={debugger:{},getURL:()=>window.url,executeJavaScript:async()=>{throw new Error('No chat selector exists');}};
 const browser=new BrowserChat({createWindow:()=>window,intervalMs:5,framesFactory:(_contents,cb)=>{callbacks=cb;return{start:async()=>{},stop:()=>{}};}});const chats=[];browser.on('chat',m=>chats.push(m));await browser.connect('test');
 callbacks.onSubscribed('chatrooms.123.v2');callbacks.onChat({id:'one',content:'live',username:'viewer'},'chatrooms.123.v2');callbacks.onChat({id:'one',content:'duplicate'},'chatrooms.123.v2');
 await new Promise(r=>setTimeout(r,15));assert.equal(browser.state.status,'connected');assert.equal(browser.state.count,1);assert.equal(chats.length,1);browser.stop();
});
test('desktop mode can use the page-owned connector for the normal Start listening action',async()=>{
 const primary=new EventEmitter();primary.state={status:'idle'};primary.stop=()=>{};primary.connect=()=>{throw new Error('Obsolete direct endpoint must not be used');};
 const browser=new EventEmitter();browser.state={status:'idle'};browser.stop=()=>{};let selected;browser.connect=async channel=>selected=channel;
 const controller=new ChatController(primary,browser,{preferBrowser:true});await controller.connect('test');assert.equal(selected,'test');controller.stop();
});
