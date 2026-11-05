'use strict';
const path = require('node:path');
const { Monitor } = require('./monitor.cjs');
const { createServer } = require('./server.cjs');
(async () => {
 const monitor = new Monitor({ resolveChannel: async channel => {
   const response = await fetch(`https://kick.com/api/v2/channels/${channel}`, { signal: AbortSignal.timeout(20000) });
   if (!response.ok) throw new Error(`Kick returned ${response.status}. Public chat access is unavailable.`);
   return (await response.json()).chatroom?.id;
 } });
 const service = await createServer({ monitor, dataDir: process.env.PINGER_DATA_DIR || path.join(require('node:os').tmpdir(), 'chat-pinger-dev'), port: Number(process.env.PORT || 4173) });
 console.log(`Chat Pinger development UI: ${service.url}`);
 for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { monitor.stop(); await service.close(); process.exit(0); });
})();
