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
