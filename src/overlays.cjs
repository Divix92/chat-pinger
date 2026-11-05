'use strict';
const {EventEmitter}=require('node:events');const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const {installOverlayVolume}=require('./overlay-audio.cjs');
function validateOverlay(input){
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>60||/[\u0000-\u001f]/.test(input.name))throw new Error('Podaj nazwę powiadomienia (maks. 60 znaków).');
 if(typeof input.url!=='string'||!input.url.trim()||input.url.length>4096)throw new Error('Wklej poprawny adres HTTPS overlayu.');
 let url;try{url=new URL(input.url.trim());}catch{throw new Error('Wklej poprawny adres HTTPS overlayu.');}
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Overlay musi używać HTTPS i nie może zawierać danych logowania przed nazwą serwera.');
 if(!Number.isFinite(input.volume)||input.volume<0||input.volume>100)throw new Error('Głośność musi mieścić się w zakresie 0–100%.');
 if(typeof input.autoStart!=='boolean')throw new Error('Niepoprawne ustawienie automatycznego uruchamiania.');
 return{name:input.name.trim(),url:url.href,volume:input.volume,autoStart:input.autoStart};
}
class OverlayManager extends EventEmitter{
 constructor({dataDir,createWindow}){super();this.file=path.join(dataDir,'overlays.json');this.createWindow=createWindow;this.sources=[];this.runtime=new Map();this.queue=Promise.resolve();this.closing=false;}
 async init(){await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});try{const entries=JSON.parse(await fs.readFile(this.file,'utf8'));if(!Array.isArray(entries))throw new Error();this.sources=entries.slice(0,20).map(entry=>{if(!/^[a-f0-9-]{36}$/i.test(entry.id))throw new Error();return{id:entry.id,...validateOverlay(entry)};});}catch(error){if(error.code!=='ENOENT')throw new Error('Nie można odczytać zapisanych overlayów. Pozostałe funkcje aplikacji nie wymagają tych ustawień.');}return this;}
 list(){return this.sources.map(entry=>({...entry,status:this.runtime.get(entry.id)?.status||'stopped',error:this.runtime.get(entry.id)?.error||''}));}
 changed(){this.emit('change');}
 async persist(){const data=JSON.stringify(this.sources,null,2);this.queue=this.queue.catch(()=>{}).then(async()=>{const temp=this.file+'.tmp';await fs.writeFile(temp,data,{mode:0o600});await fs.rename(temp,this.file);});await this.queue;}
 source(id){const source=this.sources.find(entry=>entry.id===id);if(!source)throw new Error('Nie znaleziono powiadomienia.');return source;}
 async create(input){if(this.sources.length>=20)throw new Error('Możesz zapisać maksymalnie 20 overlayów.');const source={id:crypto.randomUUID(),...validateOverlay(input)};this.sources.push(source);try{await this.persist();}catch(error){this.sources.pop();throw error;}this.changed();if(source.autoStart)this.start(source.id);return source;}
 async update(id,input){const source=this.source(id);const next=validateOverlay(input);const old={...source};const urlChanged=source.url!==next.url;Object.assign(source,next);try{await this.persist();}catch(error){Object.assign(source,old);throw error;}const active=this.runtime.get(id);if(active?.window.isDestroyed()){this.runtime.delete(id);}else if(active&&urlChanged){this.stop(id);this.start(id);}else if(active){active.window.setTitle(`Powiadomienia — ${source.name}`);await this.applyVolume(source,active);}this.changed();return source;}
 async remove(id){this.source(id);const previous=this.sources;this.sources=this.sources.filter(entry=>entry.id!==id);try{await this.persist();}catch(error){this.sources=previous;throw error;}this.stop(id);this.changed();}
 start(id,{show=true}={}){const source=this.source(id);if(this.closing)return;const current=this.runtime.get(id);if(current?.window&&!current.window.isDestroyed()){if(show){current.window.show();current.window.focus();}return;}
 const window=this.createWindow(source);const runtime={window,status:'loading',error:'',closing:false,script:null};this.runtime.set(id,runtime);window.webContents.setAudioMuted(source.volume===0);this.changed();
 window.on('close',event=>{if(!runtime.closing&&!this.closing){event.preventDefault();window.hide();}});
 window.on('closed',()=>{if(this.runtime.get(id)===runtime){if(runtime.status!=='error')this.runtime.delete(id);this.changed();}});
 window.webContents.on('did-fail-load',(_event,_code,_description,_url,isMainFrame)=>{if(isMainFrame!==false&&this.runtime.get(id)===runtime){runtime.status='error';runtime.error='Nie udało się wczytać overlayu. Sprawdź adres i połączenie.';this.changed();}});
 runtime.startup=(async()=>{try{
   // Create the renderer before enabling page scripts; no remote content runs yet.
   await window.loadURL('about:blank');if(this.runtime.get(id)!==runtime)return;
   window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('Page.enable');await this.applyVolume(source,runtime);
   await window.loadURL(source.url);if(this.runtime.get(id)!==runtime)return;
   runtime.status='running';runtime.error='';if(show)window.show();this.changed();
 }catch{if(this.runtime.get(id)===runtime){runtime.status='error';runtime.error='Overlay nie został uruchomiony. Sprawdź link lub spróbuj ponownie.';runtime.closing=true;if(!window.isDestroyed())window.close();this.changed();}}})();
 }
 async applyVolume(source,runtime){if(runtime.window.isDestroyed())return;const contents=runtime.window.webContents;contents.setAudioMuted(source.volume===0);const script=`(${installOverlayVolume.toString()})(${source.volume/100})`;
 if(contents.debugger.isAttached()){if(runtime.script)await contents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:runtime.script});const result=await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:script});runtime.script=result.identifier;}
 const frames=contents.mainFrame.framesInSubtree||[contents.mainFrame];await Promise.allSettled(frames.map(frame=>frame.executeJavaScript(script)));
 }
 stop(id){const runtime=this.runtime.get(id);if(!runtime)return;this.runtime.delete(id);runtime.closing=true;if(!runtime.window.isDestroyed())runtime.window.close();this.changed();}
 show(id){this.source(id);const runtime=this.runtime.get(id);if(!runtime||runtime.status==='error'){this.stop(id);this.start(id);return;}runtime.window.show();runtime.window.focus();}
 autoStart(){for(const source of this.sources)if(source.autoStart)this.start(source.id,{show:false});}
 closeAll(){this.closing=true;for(const id of [...this.runtime.keys()])this.stop(id);}
}
module.exports={OverlayManager,validateOverlay};
