const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {OverlayManager,validateOverlay}=require('../src/overlays.cjs');
const example={name:'StreamElements',url:'https://alerts.example/overlay/example-private-token',volume:75,autoStart:false};
class Window extends EventEmitter{
 constructor(){super();this.destroyed=false;this.visible=false;this.loads=[];this.scripts=[];let attached=false;this.webContents=new EventEmitter();this.webContents.setAudioMuted=value=>this.muted=value;this.webContents.debugger={attach:()=>attached=true,isAttached:()=>attached,sendCommand:async(method,input)=>{if(method==='Page.addScriptToEvaluateOnNewDocument'){this.scripts.push(input.source);return{identifier:String(this.scripts.length)};}return{};}};const frame={executeJavaScript:async source=>{this.lastScript=source;}};frame.framesInSubtree=[frame];this.webContents.mainFrame=frame;}
 async loadURL(url){this.loads.push(url);if(url.includes('unavailable'))throw new Error('load failed with private URL: '+url);}
 isDestroyed(){return this.destroyed;}show(){this.visible=true;}hide(){this.visible=false;}focus(){}setTitle(title){this.title=title;}
 close(){let prevented=false;this.emit('close',{preventDefault:()=>prevented=true});if(!prevented){this.destroyed=true;this.emit('closed');}}
}
async function ready(manager,id){for(let i=0;i<50;i++){const source=manager.list().find(entry=>entry.id===id);if(source.status!=='loading')return source;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Overlay did not finish startup');}
test('validates private HTTPS sources without exposing their address in errors',()=>{
 assert.equal(validateOverlay(example).volume,75);
 for(const url of ['javascript:alert(1)','file:///etc/passwd','http://alerts.example/source','https://user:password@alerts.example/private'])assert.throws(()=>validateOverlay({...example,url}));
 for(const volume of [-1,101,NaN])assert.throws(()=>validateOverlay({...example,volume}));assert.throws(()=>validateOverlay({...example,name:''}));
});
test('persists named overlays, applies volume, keeps hidden previews running and deletes locally',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pinger-overlays-'));const windows=[];const manager=await new OverlayManager({dataDir,createWindow:()=>{const window=new Window();windows.push(window);return window;}}).init();t.after(async()=>{manager.closeAll();await fs.rm(dataDir,{recursive:true,force:true});});
 const source=await manager.create(example);assert.equal(manager.list()[0].status,'stopped');manager.start(source.id);assert.equal((await ready(manager,source.id)).status,'running');assert.equal(windows[0].visible,true);
 windows[0].close();assert.equal(windows[0].visible,false);assert.equal(windows[0].destroyed,false);assert.equal(manager.list()[0].status,'running');manager.show(source.id);assert.equal(windows[0].visible,true);
 await manager.update(source.id,{...example,volume:0});assert.equal(windows[0].muted,true);assert.match(windows[0].lastScript,/\)\(0\)$/);
 const restored=await new OverlayManager({dataDir,createWindow:()=>new Window()}).init();assert.equal(restored.list()[0].url,example.url);assert.equal(restored.list()[0].volume,0);
 if(process.platform!=='win32')assert.equal((await fs.stat(path.join(dataDir,'overlays.json'))).mode&0o777,0o600);
 await manager.remove(source.id);assert.equal(windows[0].destroyed,true);assert.deepEqual(manager.list(),[]);assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir,'overlays.json'),'utf8')),[]);
});
test('preserves a safe failure status and can restart an edited failed source',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pinger-overlay-errors-'));const manager=await new OverlayManager({dataDir,createWindow:()=>new Window()}).init();t.after(async()=>{manager.closeAll();await fs.rm(dataDir,{recursive:true,force:true});});
 const source=await manager.create({...example,url:'https://alerts.example/unavailable/private-test-value'});manager.start(source.id);const result=await ready(manager,source.id);assert.equal(result.status,'error');assert.equal(result.error.includes('private-test-value'),false);
 await manager.update(source.id,example);manager.start(source.id);assert.equal((await ready(manager,source.id)).status,'running');manager.stop(source.id);assert.equal(manager.list()[0].status,'stopped');
});
