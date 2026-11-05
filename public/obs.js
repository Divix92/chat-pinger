import { SoundPlayer } from './audio.js';
const token = location.hash.slice(1) || sessionStorage.getItem('pinger-token') || '';
sessionStorage.setItem('pinger-token', token); history.replaceState(null,'',location.pathname);
const player = new SoundPlayer({soundUrl:`/obs-api/sound?token=${token}`}); let settings;
const events = new EventSource(`/obs-api/events?token=${token}`);
events.addEventListener('state', e => settings = JSON.parse(e.data).settings);
events.addEventListener('settings', e => { settings = JSON.parse(e.data); player.custom = null; });
function play(force = false) { if (settings && settings.output !== 'desktop') player.play(settings, force).catch(console.error); }
events.addEventListener('chat', () => play()); events.addEventListener('preview', () => play(true));
