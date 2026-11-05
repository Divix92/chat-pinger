'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const PUBLIC = path.join(__dirname, '../public');
const defaults = { sound: 'chime', volume: 65, output: 'desktop', muted: false, channel: '', customName: '' };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
async function createServer({ monitor, dataDir, port = 0, overlays = null }) {
  await fs.mkdir(dataDir, { recursive: true });
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8')) }; } catch {}
  const token = crypto.randomBytes(24).toString('hex');
  const clients = new Set(); let writeQueue = Promise.resolve(); let origin;
  const broadcast = (event, data) => { const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const client of clients) { if (client.write(frame) === false) client.destroy(); } };
  const onStatus = s => broadcast('status', s); const onChat = m => broadcast('chat', m);
  monitor.on('status', onStatus); monitor.on('chat', onChat);
  const onOverlays=()=>broadcast('overlays-changed',{}); overlays?.on('change',onOverlays);
  const snapshot = () => ({ settings, monitor: monitor.state, browserAvailable: typeof monitor.connectBrowser === 'function', obsUrl: `${origin}/obs#${token}` });
  async function persist() {
    const content = JSON.stringify(settings, null, 2);
    const operation = writeQueue.catch(() => {}).then(async () => { const temporary = path.join(dataDir, 'settings.tmp'); await fs.writeFile(temporary, content); await fs.rename(temporary, path.join(dataDir, 'settings.json')); });
    writeQueue = operation; await operation;
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, value, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(value) : value); };
    try {
      if (req.headers.host !== new URL(origin).host) return reply(403, { error: 'Invalid host.' });
      if (req.headers.origin && req.headers.origin !== origin) return reply(403, { error: 'Invalid origin.' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'");
      const url = new URL(req.url, origin);
      const obs = url.pathname.startsWith('/obs-api/');
      if ((url.pathname.startsWith('/api/') || obs) && (req.headers['x-pinger-token'] || url.searchParams.get('token')) !== token) return reply(401, { error: 'Unauthorized.' });
      if (req.method === 'GET' && url.pathname === '/api/overlays') return reply(200,{available:Boolean(overlays)&&!overlays.loadError,sources:overlays?.list()||[],error:overlays?.loadError||''});
      if (req.method === 'GET' && ['/api/state', '/obs-api/state'].includes(url.pathname)) return reply(200, snapshot());
      if (req.method === 'GET' && ['/api/events', '/obs-api/events'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`); clients.add(res);
        req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET' && ['/api/sound', '/obs-api/sound'].includes(url.pathname)) {
        let buffer; try { buffer = await fs.readFile(path.join(dataDir, 'custom-audio')); } catch { return reply(404, { error: 'No custom sound imported.' }); }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buffer); return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 10 * 1024 * 1024) return reply(413, { error: 'Sound must be smaller than 10 MB.' }); chunks.push(chunk); }
        const body = Buffer.concat(chunks);
        if (url.pathname === '/api/sound') {
          if (!body.length) return reply(400, { error: 'Choose an audio file.' });
          await fs.writeFile(path.join(dataDir, 'custom-audio'), body);
          settings = { ...settings, sound: 'custom', customName: String(url.searchParams.get('name') || 'Custom sound').slice(0, 120) };
          await persist(); broadcast('settings', settings); return reply(200, snapshot());
        }
        let input; try { input = JSON.parse(body.toString() || '{}'); } catch { return reply(400, { error: 'Invalid JSON.' }); }
        if (url.pathname === '/api/overlays') {
          if(!overlays)throw new Error('Overlaye są dostępne w aplikacji desktopowej.');
          if(overlays.loadError)throw new Error(overlays.loadError);
          switch(input.action){
            case 'create': await overlays.create(input); break;
            case 'update': await overlays.update(input.id,input); break;
            case 'remove': await overlays.remove(input.id); break;
            case 'start': overlays.start(input.id); break;
            case 'stop': overlays.stop(input.id); break;
            case 'show': overlays.show(input.id); break;
            default: throw new Error('Nieznana operacja overlayu.');
          }
          return reply(200,{sources:overlays.list()});
        }
        if (['/api/connect','/api/connect-browser'].includes(url.pathname)) {
          if (url.pathname === '/api/connect-browser' && typeof monitor.connectBrowser !== 'function') throw new Error('The Kick chat window is available in the desktop app.');
          const { parseChannel } = require('./channel.cjs'); const channel = parseChannel(input.channel);
          settings = { ...settings, channel }; await persist(); broadcast('settings', settings);
          void (url.pathname === '/api/connect-browser' ? monitor.connectBrowser(channel) : monitor.connect(channel)); return reply(200, snapshot());
        }
        if (url.pathname === '/api/stop') { monitor.stop(); return reply(200, snapshot()); }
        if (url.pathname === '/api/test') { broadcast('preview', {}); return reply(200, { ok: true }); }
        if (url.pathname === '/api/settings') {
          const next = { ...settings };
          if ('volume' in input) { if (!Number.isFinite(input.volume) || input.volume < 0 || input.volume > 100) throw new Error('Volume must be between 0 and 100.'); next.volume = input.volume; }
          if ('sound' in input) { if (!['chime','ping','bell','retro','drop','custom'].includes(input.sound)) throw new Error('Unknown sound.'); next.sound = input.sound; }
          if ('output' in input) { if (!['desktop','obs','both'].includes(input.output)) throw new Error('Unknown output.'); next.output = input.output; }
          if ('muted' in input) { if (typeof input.muted !== 'boolean') throw new Error('Invalid mute value.'); next.muted = input.muted; }
          settings = next; await persist(); broadcast('settings', settings); return reply(200, snapshot());
        }
        return reply(404, { error: 'Not found.' });
      }
      const files = { '/': 'index.html', '/obs': 'obs.html', '/app.js': 'app.js', '/audio.js': 'audio.js', '/style.css': 'style.css', '/obs.js': 'obs.js' };
      if (req.method !== 'GET' || !files[url.pathname]) return reply(404, { error: 'Not found.' });
      const file = files[url.pathname]; reply(200, await fs.readFile(path.join(PUBLIC, file)), types[path.extname(file)]);
    } catch (error) { if (!res.headersSent) reply(400, { error: error.message }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000); heartbeat.unref();
  return { server, token, origin, url: `${origin}/#${token}`, close: async () => { clearInterval(heartbeat); monitor.off('status', onStatus); monitor.off('chat', onChat); overlays?.off('change',onOverlays); for (const client of clients) client.end(); await writeQueue.catch(() => {}); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { createServer, defaults };
