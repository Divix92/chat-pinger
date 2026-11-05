'use strict';
const { EventEmitter } = require('node:events');
const { parseChannel } = require('./channel.cjs');
const { BrowserFrames } = require('./browser-frames.cjs');
// Runs in the remote page without Node access or an exposed IPC bridge.
function collectChat() {
  const key = '__chatPingerObserverV2';
  const root = document.querySelector('#chatroom-messages, [data-chat-messages], [data-testid="chat-messages"], [role="log"]');
  let state = window[key];
  if (!root) { state?.observer?.disconnect(); delete window[key]; return { ready:false, messages:[] }; }
  if (!state || state.root !== root) {
    state?.observer?.disconnect();
    state = { root, seen:new WeakSet(), queue:[], ready:false };
    const entries = () => [...root.querySelectorAll('.chat-entry, [data-chat-entry], [data-message-id], [data-index], [data-testid="chat-message"]')].filter(node => !node.parentElement?.closest('.chat-entry, [data-chat-entry], [data-message-id], [data-index], [data-testid="chat-message"]'));
    const seed = () => { for (const node of entries()) state.seen.add(node); };
    seed();
    // Let the first history render settle; it must not produce notification bursts.
    state.timer = setTimeout(() => { seed(); state.ready = true; }, 1500);
    state.observer = new MutationObserver(() => {
      if (!state.ready) { seed(); return; }
      for (const node of entries()) {
        if (state.seen.has(node)) continue;
        // Kick builds some message elements in stages. Retry incomplete entries.
        const content = node.querySelector('.chat-entry-content, [data-message-content]');
        const username = node.querySelector('[data-username], button[title], a[href]');
        const text = (content?.textContent || node.textContent || '').trim();
        if (!text) continue;
        state.seen.add(node);
        state.queue.push({ username:(username?.getAttribute('data-username') || username?.textContent || 'Viewer').trim().slice(0,80), content:text.slice(0,500) });
        if (state.queue.length > 100) state.queue.shift();
      }
    });
    state.observer.observe(root, {childList:true,subtree:true,characterData:true});
    window[key] = state;
  }
  return { ready:state.ready, messages:state.queue.splice(0,100) };
}
class BrowserChat extends EventEmitter {
  constructor({ createWindow, intervalMs = 500, framesFactory = (contents, callbacks) => new BrowserFrames(contents,callbacks) } = {}) {
    super(); this.createWindow = createWindow; this.intervalMs = intervalMs; this.framesFactory = framesFactory; this.generation = 0; this.sequence=0;
    this.state = {status:'idle',channel:'',count:0,message:'Ready when you are.'};
  }
  publish(status,message) { this.state={...this.state,status,message};this.emit('status',this.state); }
  async connect(input) {
    const channel = parseChannel(input); this.stop(false); const generation=this.generation;
    this.state={status:'connecting',channel,count:0,message:'Opening Kick chat…'};this.publish('connecting',this.state.message);
    const window=this.createWindow();this.window=window;this.socketActive=false;this.seen=new Set();this.chatRoom=null;
    window.on('closed',()=>{if(generation===this.generation){this.stop(false);this.publish('idle','Kick chat window closed. Monitoring stopped.');}});
    try {
      const startup=[];
      if (window.webContents.debugger) {
        this.frames=this.framesFactory(window.webContents,{
          onSubscribed: room=>{if(generation!==this.generation)return;this.chatRoom=room;this.socketActive=true;this.publish('connected',`Listening to ${channel} through Kick’s own chat connection. Keep the chat window open.`);},
          onChat:(message,room)=>{
            if(generation!==this.generation || (this.chatRoom && this.chatRoom!==room) || this.seen.has(message.id))return;
            this.chatRoom=room;this.socketActive=true;this.seen.add(message.id);if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);
            this.state={...this.state,count:this.state.count+1};this.publish('connected',`Listening to ${channel} through Kick’s own chat connection. Keep the chat window open.`);this.emit('chat',message);
          },
          onClosed:()=>{if(generation===this.generation){this.socketActive=false;this.publish('connecting','Kick chat connection closed. Waiting for the page to reconnect…');}},
          onDetached:()=>{if(generation===this.generation){this.socketActive=false;this.publish('connecting','Chat inspection detached. Reopen the Kick chat window.');}}
        });
        startup.push(this.frames.start().catch(error=>{if(generation===this.generation)this.publish('connecting',`Live chat inspection unavailable: ${error.message} Trying page observation.`);}));
      }
      // A new webContents may not have a renderer until its first navigation.
      // Start navigation while Network.enable is pending, rather than deadlock.
      startup.push(window.loadURL(`https://kick.com/popout/${channel}/chat`));
      await Promise.all(startup);
      if(generation!==this.generation)return;
      const poll=async()=>{
        if(generation!==this.generation||window.isDestroyed())return;
        try {
          const url=new URL(window.webContents.getURL());
          if(url.protocol!=='https:'||!['kick.com','www.kick.com'].includes(url.hostname)) { this.publish('connecting','Return to the Kick chat page to monitor messages.'); }
          else if (!this.socketActive) {
            const result=await window.webContents.executeJavaScript(`(${collectChat.toString()})()`);
            if(generation!==this.generation)return;
            if(this.socketActive){this.timer=setTimeout(poll,this.intervalMs);return;}
            this.publish(result.ready?'connected':'connecting',result.ready?`Watching ${channel} in the Kick chat window. Keep it open.`:'Waiting for Kick chat. Complete any verification in the chat window; initial history is ignored.');
            for(const message of result.messages){
              this.state={...this.state,count:this.state.count+1};
              this.emit('chat',{...message,id:`browser-${++this.sequence}`,time:Date.now()});
            }
            this.emit('status',this.state);
          }
        }catch {if(generation===this.generation)this.publish('connecting','Waiting for the Kick chat page to finish loading…');}
        if(generation===this.generation)this.timer=setTimeout(poll,this.intervalMs);
      };
      void poll();
    }catch(error){if(generation===this.generation)this.publish('error',`Kick chat page could not load: ${error.message}`);}
  }
  stop(notify=true){this.generation++;clearTimeout(this.timer);this.frames?.stop();this.frames=null;const window=this.window;this.window=null;if(window&&!window.isDestroyed())window.close();if(notify)this.publish('idle','Monitoring stopped.');}
}
class ChatController extends EventEmitter {
  constructor(primary,browser,{preferBrowser=false}={}){
    super();this.primary=primary;this.browser=browser;this.active=primary;this.preferBrowser=preferBrowser;
    for(const backend of [primary,browser])for(const event of ['status','chat'])backend.on(event,data=>{if(this.active===backend)this.emit(event,data);});
  }
  get state(){return this.active.state;}
  connect(channel){if(this.preferBrowser)return this.connectBrowser(channel);parseChannel(channel);this.active.stop(false);this.active=this.primary;return this.active.connect(channel);}
  connectBrowser(channel){parseChannel(channel);this.active.stop(false);this.active=this.browser;return this.active.connect(channel);}
  stop(notify=true){this.active.stop(notify);}
}
module.exports={BrowserChat,ChatController,collectChat};
