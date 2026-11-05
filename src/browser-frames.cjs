'use strict';
// Inspect only incoming public chat events. Do not collect headers, cookies,
// outgoing websocket frames, authentication messages, or general network data.
function parseChatFrame(payload) {
  let frame, data;
  try { frame=JSON.parse(payload); } catch { return null; }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (frame.event === 'pusher_internal:subscription_succeeded' && /^chatrooms\.\d+\.v2$/.test(frame.channel || '')) return {type:'subscribed',channel:frame.channel};
  if (frame.event !== 'App\\Events\\ChatMessageEvent') return null;
  if (!/^chatrooms\.\d+\.v2$/.test(frame.channel || '')) return null;
  try { data=typeof frame.data==='string'?JSON.parse(frame.data):frame.data; } catch { return null; }
  if (!data || !['string','number'].includes(typeof data.id) || !String(data.id) || typeof data.content!=='string') return null;
  return {type:'chat',channel:frame.channel,message:{id:String(data.id),username:String(data.sender?.username || 'Viewer').slice(0,80),content:data.content.slice(0,500),time:Date.now()}};
}
class BrowserFrames {
  constructor(contents,{onSubscribed,onChat,onClosed,onDetached}={}) { this.contents=contents;this.debuggerAPI=contents.debugger;this.callbacks={onSubscribed,onChat,onClosed,onDetached};this.requests=new Set();this.stopped=false; }
  async start() {
    const debuggerAPI=this.debuggerAPI;
    if (debuggerAPI.isAttached()) throw new Error('Chat inspection is already attached. Close developer tools and reopen chat.');
    debuggerAPI.attach('1.3');this.attached=true;
    this.listener=(_event,method,params)=>{
      if(this.stopped)return;
      if(method==='Network.webSocketClosed' && this.requests.delete(params.requestId)){if(this.activeRequest===params.requestId)this.callbacks.onClosed?.();return;}
      if(method!=='Network.webSocketFrameReceived'||params.response?.opcode!==1)return;
      const result=parseChatFrame(params.response.payloadData);if(!result)return;
      this.requests.add(params.requestId);this.activeRequest=params.requestId;
      if(result.type==='subscribed')this.callbacks.onSubscribed?.(result.channel);
      else this.callbacks.onChat?.(result.message,result.channel);
    };
    this.detachListener=()=>{if(!this.stopped)this.callbacks.onDetached?.();};
    debuggerAPI.on('message',this.listener);debuggerAPI.on('detach',this.detachListener);
    try {await debuggerAPI.sendCommand('Network.enable');}catch(error){this.stop();throw error;}
  }
  stop(){this.stopped=true;const api=this.debuggerAPI;if(this.listener)api.removeListener('message',this.listener);if(this.detachListener)api.removeListener('detach',this.detachListener);try{if(this.attached&&api.isAttached())api.detach();}catch{/* The chat window may already be destroyed. */}this.requests.clear();}
}
module.exports={BrowserFrames,parseChatFrame};
