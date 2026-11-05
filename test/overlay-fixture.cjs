const {app,session,BrowserWindow}=require('electron');const assert=require('node:assert/strict');
async function until(read,predicate,label){const end=Date.now()+15000;let last;while(Date.now()<end){last=await read();if(predicate(last))return last;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);}
function renderLevel(){const context=new OfflineAudioContext(1,128,44100);const source=context.createConstantSource();source.offset.value=1;source.connect(context.destination);source.start();return context.startRendering().then(buffer=>buffer.getChannelData(0)[64]);}
app.whenReady().then(async()=>{
 require('../src/main.cjs');
 const main=await until(async()=>BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Chat Pinger'),Boolean,'main window');
 const js=code=>main.webContents.executeJavaScript(code,true);
 await until(async()=>{try{return await js("Boolean(document.getElementById('overlay-new')&&!document.getElementById('overlay-new').disabled)");}catch{return false;}},Boolean,'overlay controls');
 await js("document.getElementById('nav-overlays').click();document.getElementById('overlay-new').click();document.getElementById('overlay-name').value='Offline overlay';document.getElementById('overlay-url').value='https://overlay.example.test/private-test-source';document.getElementById('overlay-volume').value='25';document.getElementById('overlay-form').requestSubmit();");
 const id=await until(()=>js("document.querySelector('.overlay-source')?.dataset.id"),Boolean,'saved overlay');
 const inner=`<script>window.renderLevel=${renderLevel.toString()};window.renderLevel().then(value=>window.initialLevel=value);</script>`;
 const html=`<!doctype html><html><head><title>Overlay fixture</title></head><body><h1>Original overlay animation fixture</h1>${inner}<iframe srcdoc="${inner.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></iframe></body></html>`;
 await session.fromPartition(`persist:pinger-overlay-${id}`).protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html'}}));
 await js("document.querySelector('.overlay-source .primary').click()");
 await until(()=>js("document.querySelector('.overlay-source-status .pill')?.textContent"),value=>value==='Aktywny','running overlay');
 const overlay=BrowserWindow.getAllWindows().find(window=>window!==main);assert(overlay,'Overlay preview window must exist');
 const frames=overlay.webContents.mainFrame.framesInSubtree;assert(frames.length>=2,'Test must exercise the overlay and a widget iframe');
 const initial=await Promise.all(frames.map(frame=>until(()=>frame.executeJavaScript('window.initialLevel'),value=>typeof value==='number','rendered frame audio')));for(const level of initial)assert(Math.abs(level-0.25)<0.001,`Expected 25% audio, got ${level}`);
 await js("const slider=document.querySelector('.overlay-source input[type=range]');slider.value='50';slider.dispatchEvent(new Event('change',{bubbles:true}));");
 await until(()=>js("document.querySelector('.overlay-source output')?.value"),value=>value==='50%','saved live volume');
 for(const frame of frames){const level=await frame.executeJavaScript('window.renderLevel()');assert(Math.abs(level-0.5)<0.001,`Expected 50% audio, got ${level}`);}
 overlay.close();assert.equal(overlay.isDestroyed(),false);assert.equal(overlay.isVisible(),false);
 await js("document.querySelector('.overlay-source .primary').click()");await until(()=>js("document.querySelector('.overlay-source-status .pill')?.textContent"),value=>value==='Wyłączony','stop overlay');assert.equal(overlay.isDestroyed(),true);
 assert.equal(await js("document.getElementById('overlay-list').textContent.includes('private-test-source')"),false);
 await js("document.querySelector('.overlay-delete').click()");await until(()=>js("document.querySelectorAll('.overlay-source').length"),value=>value===0,'delete overlay');
 console.log('PASS: Electron overlay UI saves a private source, runs it in an isolated window, scales real audio in root/widget frames, updates volume, hides previews, stops and deletes. Offline fixtures only.');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
