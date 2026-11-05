import { sounds, SoundPlayer } from './audio.js';
const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('pinger-token') || '';
sessionStorage.setItem('pinger-token', token); history.replaceState(null, '', location.pathname);
let settings, events, saveQueue = Promise.resolve();
const player = new SoundPlayer({ soundUrl: `/api/sound?token=${token}` });
function error(message) { $('error').textContent = message; $('error').hidden = !message; }
async function api(path, input) {
 const response = await fetch(`/api/${path}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'x-pinger-token': token, 'Content-Type':'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) });
 const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
}
function renderSettings(next) {
 settings = next; $('volume').value = next.volume; $('volume-value').value = `${next.volume}%`;
 $('custom-label').textContent = next.customName || 'MP3, WAV or OGG · up to 10 MB / 10 seconds';
 $('mute').textContent = next.muted ? 'Unmute alerts' : 'Mute alerts'; $('mute').setAttribute('aria-pressed', next.muted); $('output').value = next.output;
 for (const button of $('sounds').children) button.setAttribute('aria-pressed', button.dataset.sound === next.sound);
 if (next.customName && !$('custom-option')) {
  addSound({ id:'custom', name:'Your sound', detail:'Imported audio', icon:'♫' }, 'custom-option');
  $('custom-option').setAttribute('aria-pressed', next.sound === 'custom');
 }
}
function save(patch) {
 saveQueue = saveQueue.catch(() => {}).then(async () => { const state = await api('settings', patch); renderSettings(state.settings); });
 saveQueue.catch(e => error(e.message)); return saveQueue;
}
function addSound(sound, id) {
 const button = document.createElement('button'); button.type = 'button'; button.className = 'sound-option'; button.dataset.sound = sound.id; if (id) button.id = id;
 const icon = document.createElement('span'); icon.className = 'icon'; icon.textContent = sound.icon;
 const label = document.createElement('span'); const name = document.createElement('strong'); name.textContent = sound.name;
 const detail = document.createElement('small'); detail.textContent = sound.detail; label.append(name, detail);
 button.append(icon, label); button.setAttribute('aria-pressed','false');
 button.addEventListener('click', async () => { try { error(''); await player.unlock(); await save({sound:sound.id}); await player.play(settings,true); } catch(e) { error(e.message); } }); $('sounds').append(button);
}
function renderStatus(state) {
 const labels = { idle:'Not connected', connecting:'Connecting', connected:'Listening', reconnecting:'Reconnecting', error:'Connection error' };
 $('status-pill').textContent = labels[state.status] || state.status; $('status-pill').className = `pill ${state.status}`;
 $('connection-status').textContent = state.message; $('count').textContent = `${state.count} message${state.count === 1 ? '' : 's'}`;
 const active = ['connected','connecting','reconnecting'].includes(state.status); $('stop').hidden = !active; $('connect').hidden = active;
}
function message(item) {
 $('empty-activity').hidden = true;
 const li = document.createElement('li'); const name = document.createElement('strong'); name.textContent = item.username;
 const time = document.createElement('time'); time.textContent = new Date(item.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 const content = document.createElement('p'); content.textContent = item.content; li.append(name,time,content); $('activity').prepend(li);
 while ($('activity').children.length > 50) $('activity').lastElementChild.remove();
 if (settings.output !== 'obs') player.play(settings).catch(e => error(e.message));
}
for (const sound of sounds) addSound(sound);
$('connect-form').addEventListener('submit', async event => { event.preventDefault(); try { error(''); await player.unlock(); await api('connect',{channel:$('channel').value}); $('activity').replaceChildren(); $('empty-activity').hidden = false; } catch(e) { error(e.message); } });
$('browser-connect').addEventListener('click',async()=>{try{error('');await player.unlock();await api('connect-browser',{channel:$('channel').value});$('activity').replaceChildren();$('empty-activity').hidden=false;}catch(e){error(e.message);}});
$('stop').addEventListener('click', () => api('stop',{}).catch(e => error(e.message)));
$('preview').addEventListener('click', async () => { try { error(''); await player.unlock(); await api('test',{}); } catch(e) { error(e.message); } });
$('volume').addEventListener('input', () => { $('volume-value').value = `${$('volume').value}%`; });
$('volume').addEventListener('change', () => save({volume:Number($('volume').value)}));
$('mute').addEventListener('click', () => save({muted:!settings.muted}));
$('output').addEventListener('change', () => save({output:$('output').value}));
$('custom').addEventListener('change', async () => {
 const file = $('custom').files[0]; if (!file) return;
 try { error(''); await player.validateFile(file);
  const response = await fetch(`/api/sound?name=${encodeURIComponent(file.name)}`, {method:'POST',headers:{'x-pinger-token':token},body:file}); const data = await response.json(); if (!response.ok) throw new Error(data.error);
  player.custom = null; renderSettings(data.settings); await player.play(settings,true);
 } catch(e) { error(e.message); } finally { $('custom').value = ''; }
});
$('copy-obs').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('obs-url').value); $('copy-obs').textContent = 'Copied'; setTimeout(() => $('copy-obs').textContent = 'Copy',1800); } catch { $('obs-url').select(); error('Copy the selected URL.'); } });
try {
 const state = await api('state'); $('browser-connect').hidden = !state.browserAvailable; renderSettings(state.settings); renderStatus(state.monitor); $('channel').value = settings.channel; $('obs-url').value = state.obsUrl;
 events = new EventSource(`/api/events?token=${token}`);
 events.addEventListener('state', e => { const state = JSON.parse(e.data); renderSettings(state.settings); renderStatus(state.monitor); });
 events.addEventListener('settings', e => renderSettings(JSON.parse(e.data)));
 events.addEventListener('status', e => renderStatus(JSON.parse(e.data)));
 events.addEventListener('chat', e => message(JSON.parse(e.data)));
 events.addEventListener('preview', () => { if (settings.output !== 'obs') player.play(settings,true).catch(e => error(e.message)); });
 events.onerror = () => error('Connection to Chat Pinger lost. Keep the app open; reconnecting…');
 events.onopen = () => error('');
} catch(e) { error(e.message); }

let overlaySources=[];let editingOverlay=null;let overlayAvailable=false;
function selectView(view){
 $('chat-view').hidden=view!=='chat';$('overlays-view').hidden=view!=='overlays';
 for(const [id,name] of [['nav-chat','chat'],['nav-overlays','overlays']]){$(id).classList.toggle('active',view===name);$(id).setAttribute('aria-pressed',String(view===name));}
 error('');if(view==='overlays')refreshOverlays().catch(e=>error(e.message));
}
$('nav-chat').addEventListener('click',()=>selectView('chat'));
$('nav-overlays').addEventListener('click',()=>selectView('overlays'));
function closeOverlayForm(){$('overlay-form').hidden=true;editingOverlay=null;$('overlay-form').reset();$('overlay-url').value='';$('overlay-volume-value').value='100%';}
function openOverlayForm(source){editingOverlay=source?.id||null;$('overlay-form').hidden=false;$('overlay-form-title').textContent=source?'Edytuj powiadomienie':'Nowe powiadomienie';$('overlay-name').value=source?.name||'';$('overlay-url').value=source?.url||'';$('overlay-volume').value=source?.volume??100;$('overlay-volume-value').value=`${source?.volume??100}%`;$('overlay-autostart').checked=source?.autoStart||false;$('overlay-name').focus();}
$('overlay-new').addEventListener('click',()=>openOverlayForm());$('overlay-cancel').addEventListener('click',closeOverlayForm);
$('overlay-volume').addEventListener('input',()=>$('overlay-volume-value').value=`${$('overlay-volume').value}%`);
async function overlayAction(action,source,patch={}){const data=await api('overlays',{action,id:source?.id,...patch});renderOverlays(data.sources);}
$('overlay-form').addEventListener('submit',async event=>{event.preventDefault();$('overlay-save').disabled=true;try{error('');await overlayAction(editingOverlay?'update':'create',{id:editingOverlay},{name:$('overlay-name').value,url:$('overlay-url').value,volume:Number($('overlay-volume').value),autoStart:$('overlay-autostart').checked});closeOverlayForm();}catch(e){error(e.message);}finally{$('overlay-save').disabled=false;}});
function renderOverlays(sources){
 overlaySources=sources;$('overlay-nav-count').textContent=sources.length;$('overlay-total').textContent=sources.length;$('overlay-empty').hidden=sources.length>0;$('overlay-list').replaceChildren();
 for(const source of sources){
  const card=document.createElement('article');card.className='card overlay-source';card.dataset.id=source.id;
  const heading=document.createElement('div');heading.className='overlay-source-status';const icon=document.createElement('span');icon.textContent='◇';const status=document.createElement('span');status.className=`pill ${source.status==='running'?'connected':source.status}`;status.textContent=({running:'Aktywny',loading:'Ładowanie…',stopped:'Wyłączony',error:'Błąd'})[source.status]||source.status;heading.append(icon,status);
  const title=document.createElement('h2');title.textContent=source.name;const host=document.createElement('p');host.className='overlay-host';host.textContent=new URL(source.url).hostname+' · prywatny link';card.append(heading,title,host);
  const volumeLabel=document.createElement('div');volumeLabel.className='volume-label';const label=document.createElement('label');label.textContent='Głośność';label.htmlFor=`overlay-level-${source.id}`;const output=document.createElement('output');output.value=`${source.volume}%`;volumeLabel.append(label,output);const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.value=source.volume;slider.id=label.htmlFor;slider.addEventListener('input',()=>output.value=`${slider.value}%`);slider.addEventListener('change',()=>overlayAction('update',source,{...source,volume:Number(slider.value)}).catch(e=>error(e.message)));card.append(volumeLabel,slider);
  const actions=document.createElement('div');actions.className='overlay-actions';const active=['running','loading'].includes(source.status);
  for(const [action,text,className] of [[active?'stop':'start',active?'Zatrzymaj':'Uruchom','primary'],['show','Podgląd','secondary'],['edit','Edytuj','text-button'],['remove','Usuń','text-button overlay-delete']]){
   const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;button.addEventListener('click',async()=>{if(action==='edit'){openOverlayForm(source);return;}button.disabled=true;try{error('');await overlayAction(action,source);}catch(e){error(e.message);button.disabled=false;}});actions.append(button);
  }
  card.append(actions);if(source.error){const text=document.createElement('p');text.className='overlay-error';text.textContent=source.error;card.append(text);}if(source.autoStart){const text=document.createElement('div');text.className='overlay-autostart-note';text.textContent='● Startuje automatycznie z aplikacją';card.append(text);}$('overlay-list').append(card);
 }
}
async function refreshOverlays(){const data=await api('overlays');overlayAvailable=data.available;$('overlay-new').disabled=!overlayAvailable;renderOverlays(data.sources);if(data.error)error(data.error);if(!overlayAvailable)$('overlay-empty').querySelector('p').textContent=data.error||'Overlaye można uruchamiać w aplikacji desktopowej.';}
if(events)events.addEventListener('overlays-changed',()=>refreshOverlays().catch(e=>error(e.message)));
refreshOverlays().catch(e=>error(e.message));
