const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {parseChatFrame,BrowserFrames}=require('../src/browser-frames.cjs');
const payload=(event,data,channel='chatrooms.123.v2')=>JSON.stringify({event,data:JSON.stringify(data),channel});
test('parses only incoming public chat messages and chat subscription acknowledgements',()=>{
 assert.equal(parseChatFrame('invalid'),null);assert.equal(parseChatFrame('null'),null);assert.equal(parseChatFrame('[]'),null);assert.equal(parseChatFrame(payload('pusher:connection_established',{socket_id:'ignore'})),null);
 assert.equal(parseChatFrame(payload('authentication',{token:'not-collected'})),null);
 assert.equal(parseChatFrame(payload('App\\Events\\ChatMessageEvent',{id:'one',content:'hello'},'private-room')),null);
 assert.equal(parseChatFrame(payload('pusher_internal:subscription_succeeded',{})).type,'subscribed');
 const result=parseChatFrame(payload('App\\Events\\ChatMessageEvent',{id:'one',content:'hello',sender:{username:'viewer'}}));
 assert.equal(result.message.content,'hello');assert.equal(result.message.username,'viewer');
});
test('captures chat frames without relying on a hostname, app key, or DOM selector',async()=>{
 const api=new EventEmitter();let attached=false;api.isAttached=()=>attached;api.attach=()=>attached=true;api.detach=()=>attached=false;api.sendCommand=async method=>assert.equal(method,'Network.enable');
 const messages=[];let subscriptions=0,closed=0;const observer=new BrowserFrames({debugger:api},{onChat:m=>messages.push(m),onSubscribed:()=>subscriptions++,onClosed:()=>closed++});await observer.start();
 const frame=(id,event,data)=>api.emit('message',{},'Network.webSocketFrameReceived',{requestId:id,response:{opcode:1,payloadData:payload(event,data)}});
 frame('old','pusher_internal:subscription_succeeded',{});frame('new','pusher_internal:subscription_succeeded',{});
 api.emit('message',{},'Network.webSocketFrameSent',{requestId:'new',response:{opcode:1,payloadData:payload('App\\Events\\ChatMessageEvent',{id:'ignored',content:'outgoing'})}});
 frame('new','App\\Events\\ChatMessageEvent',{id:'one',content:'new message'});
 api.emit('message',{},'Network.webSocketClosed',{requestId:'old'});assert.equal(closed,0);
 api.emit('message',{},'Network.webSocketClosed',{requestId:'new'});assert.equal(closed,1);assert.equal(subscriptions,2);assert.equal(messages.length,1);
 observer.stop();assert.equal(attached,false);assert.equal(api.listenerCount('message'),0);
});
