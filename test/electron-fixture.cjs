const {app,session,BrowserWindow}=require('electron');
const http=require('node:http');const crypto=require('node:crypto');const assert=require('node:assert/strict');
function send(socket,value){const body=Buffer.from(JSON.stringify(value));const header=Buffer.alloc(body.length<126?2:4);header[0]=0x81;if(body.length<126)header[1]=body.length;else{header[1]=126;header.writeUInt16BE(body.length,2);}socket.write(Buffer.concat([header,body]));}
async function until(read,predicate,label){const end=Date.now()+15000;let latest;while(Date.now()<end){latest=await read();if(predicate(latest))return latest;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(`Timed out waiting for ${label}; last state: ${JSON.stringify(latest)}`);}
const sockets=new Set();let connection,server;
app.whenReady().then(async()=>{
 server=http.createServer((_req,res)=>res.end('Offline chat fixture'));
 server.on('upgrade',(req,socket)=>{const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');sockets.add(socket);connection=socket;socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));setTimeout(()=>{if(!socket.destroyed)send(socket,{event:'pusher_internal:subscription_succeeded',channel:'chatrooms.123.v2',data:'{}'});},100);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const html=`<!doctype html><html><head><title>Offline chat fixture</title></head><body><p>No chat message DOM selectors exist on this fixture.</p><script>window.chatSocket=new WebSocket('ws://127.0.0.1:${port}');window.chatSocket.onmessage=()=>{};</script></body></html>`;
 await session.defaultSession.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html'}}));
 require('../src/main.cjs');
 const main=await until(async()=>BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Chat Pinger'),Boolean,'main app window');
 await until(async()=>{try{return await main.webContents.executeJavaScript("Boolean(document.getElementById('channel') && document.getElementById('browser-connect') && !document.getElementById('browser-connect').hidden)");}catch{return false;}},Boolean,'loaded app controls');
 await main.webContents.executeJavaScript("document.getElementById('channel').value='test'; document.getElementById('connect-form').requestSubmit();",true);
 await until(()=>main.webContents.executeJavaScript("document.getElementById('status-pill').textContent"),value=>value==='Listening','page-owned chat subscription');
 assert(connection,'A real browser websocket must connect to the local server');
 const frame={event:'App\\Events\\ChatMessageEvent',channel:'chatrooms.123.v2',data:JSON.stringify({id:'real-browser-socket',content:'message captured without DOM selectors',sender:{username:'fixture viewer'}})};
 send(connection,frame);send(connection,frame);
 await until(()=>main.webContents.executeJavaScript("document.getElementById('activity').textContent"),value=>value.includes('message captured without DOM selectors'),'incoming message in app activity');
 assert.equal(await main.webContents.executeJavaScript("document.querySelectorAll('#activity li').length"),1);
 assert.equal(await main.webContents.executeJavaScript("document.getElementById('count').textContent"),'1 message');
 const chat=BrowserWindow.getAllWindows().find(window=>window!==main);assert(chat,'Visible chat window must exist');chat.close();
 await until(()=>main.webContents.executeJavaScript("document.getElementById('connection-status').textContent"),value=>value==='Kick chat window closed. Monitoring stopped.','chat close cleanup');
 console.log('PASS: actual Electron captures real browser websocket frames without chat DOM selectors, delivers duplicate IDs once, and stops on window close. Offline fixtures only.');
 for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));app.quit();
}).catch(error=>{console.error(error);for(const socket of sockets)socket.destroy();server?.close();app.exit(1);});
