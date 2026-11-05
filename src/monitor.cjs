'use strict';
const { EventEmitter } = require('node:events');
const { parseChannel } = require('./channel.cjs');
// Kick's public website transport; not a guaranteed public API contract.
const SOCKET_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
class Monitor extends EventEmitter {
  constructor({ resolveChannel, socketFactory = url => new WebSocket(url), retryBase = 1000, handshakeMs = 20000 } = {}) {
    super(); this.resolveChannel = resolveChannel; this.socketFactory = socketFactory;
    this.retryBase = retryBase; this.handshakeMs = handshakeMs;
    this.state = { status: 'idle', channel: '', message: 'Ready when you are.', count: 0 };
    this.generation = 0; this.seen = new Set(); this.attempt = 0;
  }
  publish(status, message) { this.state = { ...this.state, status, message }; this.emit('status', this.state); }
  async connect(input) {
    const channel = parseChannel(input);
    this.stop(false); const generation = this.generation;
    this.state = { status: 'connecting', channel, count: 0, message: 'Finding channel…' };
    this.seen.clear(); this.attempt = 0; this.publish('connecting', 'Finding channel…');
    try {
      const room = await this.resolveChannel(channel);
      if (generation !== this.generation) return;
      if (!Number.isSafeInteger(Number(room)) || Number(room) <= 0) throw new Error('Kick did not return a valid chatroom for this channel.');
      this.room = String(room); this.open(generation);
    } catch (error) { if (generation === this.generation) this.publish('error', error.message); }
  }
  open(generation) {
    if (generation !== this.generation) return;
    this.publish('connecting', 'Connecting to live chat…');
    let socket;
    try { socket = this.socketFactory(SOCKET_URL); } catch { this.retry(generation); return; }
    this.socket = socket;
    const current = () => generation === this.generation && this.socket === socket;
    const send = data => { if (socket.readyState === 1) socket.send(JSON.stringify(data)); };
    let watchdog;
    const arm = (ms = this.handshakeMs) => { clearTimeout(watchdog); watchdog = setTimeout(() => { if (current()) socket.close(); }, ms); watchdog.unref?.(); };
    arm();
    socket.addEventListener('message', event => {
      if (!current()) return;
      let frame, data;
      try { frame = JSON.parse(String(event.data)); data = typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data; } catch { return; }
      arm(this.activityMs || this.handshakeMs);
      if (frame.event === 'pusher:connection_established') {
        this.activityMs = Math.min(180000, Math.max(30000, (Number(data?.activity_timeout) || 120) * 1000 + 10000));
        arm(this.activityMs);
        send({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${this.room}.v2` } });
      } else if (frame.event === 'pusher:ping') send({ event: 'pusher:pong', data: {} });
      else if (frame.event === 'pusher_internal:subscription_succeeded' && frame.channel === `chatrooms.${this.room}.v2`) {
        this.attempt = 0; this.publish('connected', `Listening to ${this.state.channel}`);
      } else if (frame.event === 'pusher:error' || frame.event === 'pusher:subscription_error') {
        socket.close();
      } else if (frame.event === 'App\\Events\\ChatMessageEvent' && frame.channel === `chatrooms.${this.room}.v2` && data && this.state.status === 'connected') {
        if ((typeof data.id !== 'string' && typeof data.id !== 'number') || !String(data.id)) return;
        const id = String(data.id);
        if (this.seen.has(id)) return;
        this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
        this.state = { ...this.state, count: this.state.count + 1 };
        this.emit('chat', { id, username: String(data.sender?.username || 'Viewer').slice(0, 80), content: String(data.content || '').slice(0, 500), time: Date.now() });
        this.emit('status', this.state);
      }
    });
    socket.addEventListener('error', () => { if (current()) socket.close(); });
    socket.addEventListener('close', () => { clearTimeout(watchdog); if (current()) this.retry(generation); });
    this.clearWatchdog = () => clearTimeout(watchdog);
  }
  retry(generation) {
    if (generation !== this.generation) return;
    const delay = Math.min(30000, this.retryBase * 2 ** Math.min(this.attempt++, 5));
    this.publish('reconnecting', `Connection lost. Retrying in ${Math.ceil(delay / 1000)}s…`);
    clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.open(generation), delay); this.retryTimer.unref?.();
  }
  stop(notify = true) {
    this.generation++; clearTimeout(this.retryTimer); this.clearWatchdog?.(); this.activityMs = null;
    const socket = this.socket; this.socket = null; socket?.close();
    if (notify) this.publish('idle', 'Monitoring stopped.');
  }
}
module.exports = { Monitor, SOCKET_URL };
