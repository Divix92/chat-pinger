'use strict';
// Runs at document creation in the overlay's page and its widget frames.
// No Node APIs or IPC bridge are exposed to the remote overlay.
function installOverlayVolume(level) {
  const value=Math.max(0,Math.min(1,Number(level)||0));
  const key='__chatPingerOverlayAudioV1';
  if(window[key]){window[key].set(value);return;}
  const mediaDescriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume');
  const originalPlay=HTMLMediaElement.prototype.play;
  const originalConnect=AudioNode.prototype.connect;
  const originalDisconnect=AudioNode.prototype.disconnect;
  const desired=new WeakMap();const playing=new Set();const masters=new WeakMap();const gains=new Set();
  const state={volume:value,set(next){this.volume=next;for(const gain of gains)gain.gain.value=next;for(const media of document.querySelectorAll('audio,video'))apply(media);for(const media of playing)apply(media);}};
  function apply(media){if(!desired.has(media))desired.set(media,mediaDescriptor.get.call(media));mediaDescriptor.set.call(media,desired.get(media)*state.volume);}
  Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,enumerable:mediaDescriptor.enumerable,get(){return desired.has(this)?desired.get(this):mediaDescriptor.get.call(this);},set(next){const numeric=Number(next);if(!Number.isFinite(numeric)||numeric<0||numeric>1){mediaDescriptor.set.call(this,next);return;}desired.set(this,numeric);apply(this);}});
  HTMLMediaElement.prototype.play=function(...args){apply(this);playing.add(this);this.addEventListener('ended',()=>playing.delete(this),{once:true});this.addEventListener('pause',()=>playing.delete(this),{once:true});return originalPlay.apply(this,args);};
  function master(context){let gain=masters.get(context);if(!gain){gain=context.createGain();gain.gain.value=state.volume;originalConnect.call(gain,context.destination);masters.set(context,gain);gains.add(gain);context.addEventListener('statechange',()=>{if(context.state==='closed')gains.delete(gain);});}return gain;}
  AudioNode.prototype.connect=function(destination,...args){if(destination===this.context.destination){originalConnect.call(this,master(this.context),...args);return destination;}return originalConnect.call(this,destination,...args);};
  AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&masters.has(this.context))args[0]=masters.get(this.context);return originalDisconnect.apply(this,args);};
  new MutationObserver(()=>{for(const media of document.querySelectorAll('audio,video'))apply(media);}).observe(document,{childList:true,subtree:true});
  window[key]=state;state.set(value);
}
module.exports={installOverlayVolume};
