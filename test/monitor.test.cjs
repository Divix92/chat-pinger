const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Monitor } = require('../src/monitor.cjs');
const { parseChannel } = require('../src/channel.cjs');
class Socket extends EventTarget {
 constructor() { super(); this.readyState = 1; this.sent = []; }
 send(data) { this.sent.push(JSON.parse(data)); }
 close() { if(this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
 message(event, data, channel = 'chatrooms.123.v2') { this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify({event,data:JSON.stringify(data),channel})})); }
}
test('accepts channel names and Kick links; rejects other hosts and paths', () => {
 for (const input of [' Test_User ', 'https://kick.com/Test_User?x=1', 'kick.com/test_user/', 'https://www.kick.com/test_user']) assert.equal(parseChannel(input), 'test_user');
 for (const input of ['', 'https://evil.example/a', 'https://kick.com.evil.example/a', 'https://kick.com/a/b', 'https://kick.com/browse', 'http://kick.com/a', 'https://user@kick.com/a', 'https://kick.com:3000/a', '../api']) assert.throws(() => parseChannel(input));
});
test('subscribes, acknowledges heartbeat, deduplicates message IDs, ignores other rooms', async () => {
 const socket = new Socket(); const monitor = new Monitor({ resolveChannel:async()=>123, socketFactory:()=>socket });
 const messages = []; monitor.on('chat', m => messages.push(m)); await monitor.connect('test');
 socket.message('App\\Events\\ChatMessageEvent', {id:'before'}); assert.equal(messages.length,0);
 socket.message('pusher:connection_established', {activity_timeout:120}); assert.equal(socket.sent[0].data.channel,'chatrooms.123.v2');
 socket.message('pusher_internal:subscription_succeeded', {}); assert.equal(monitor.state.status,'connected');
 socket.message('pusher:ping', {}); assert.equal(socket.sent[1].event,'pusher:pong');
 socket.message('App\\Events\\ChatMessageEvent', {id:'one',content:'hello',sender:{username:'viewer'}});
 socket.message('App\\Events\\ChatMessageEvent', {id:'one',content:'duplicate'});
 socket.message('App\\Events\\ChatMessageEvent', {id:'two'}, 'chatrooms.999.v2');
 socket.message('App\\Events\\ChatMessageEvent', {content:'no id'});
 assert.equal(messages.length,1); assert.equal(messages[0].content,'hello'); assert.equal(monitor.state.count,1); monitor.stop();
});
test('disconnect cancels pending lookup and stale sockets', async () => {
 let resolve; let opened=0; const monitor = new Monitor({ resolveChannel:()=>new Promise(r=>resolve=r), socketFactory:()=>{opened++;return new Socket();} });
 const pending=monitor.connect('test'); monitor.stop(); resolve(123); await pending; assert.equal(opened,0); assert.equal(monitor.state.status,'idle');
});
test('lookup failures are actionable and invalid metadata is rejected', async () => {
 const monitor=new Monitor({resolveChannel:async()=>undefined}); await monitor.connect('test'); assert.equal(monitor.state.status,'error'); assert.match(monitor.state.message,/valid chatroom/); monitor.stop();
});
test('reconnects after transport failure and preserves deduplication', async () => {
 const sockets=[]; const monitor=new Monitor({resolveChannel:async()=>123,socketFactory:()=>{const s=new Socket();sockets.push(s);return s;},retryBase:5});
 await monitor.connect('test'); sockets[0].message('pusher_internal:subscription_succeeded',{}); sockets[0].message('App\\Events\\ChatMessageEvent',{id:'a'}); sockets[0].close();
 assert.equal(monitor.state.status,'reconnecting'); await new Promise(r=>setTimeout(r,20)); assert.equal(sockets.length,2);
 sockets[1].message('pusher_internal:subscription_succeeded',{}); sockets[1].message('App\\Events\\ChatMessageEvent',{id:'a'}); assert.equal(monitor.state.count,1); monitor.stop();
});
test('exposes server rejection and stops retrying permanent Pusher errors',async()=>{
 const socket=new Socket();const monitor=new Monitor({resolveChannel:async()=>123,socketFactory:()=>socket});await monitor.connect('test');
 socket.message('pusher:error',{code:4001,message:'Application does not exist'});
 assert.equal(monitor.state.status,'error');assert.match(monitor.state.message,/4001/);assert.match(monitor.state.message,/Application does not exist/);assert.match(monitor.state.message,/fallback/);monitor.stop();
});
test('constructor failure reports the cause and has a bounded retry budget',async()=>{
 const monitor=new Monitor({resolveChannel:async()=>123,socketFactory:()=>{throw new Error('transport unavailable');},retryBase:5,maxRetries:1});
 await monitor.connect('test');assert.match(monitor.state.message,/transport unavailable/);await new Promise(r=>setTimeout(r,20));assert.equal(monitor.state.status,'error');monitor.stop();
});
