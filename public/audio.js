export const sounds = [
 { id:'chime', name:'Short chime', detail:'Bright & gentle', icon:'♧', notes:[[880,0,.32],[1320,.13,.42]] },
 { id:'ping', name:'Soft ping', detail:'Simple & subtle', icon:'◦', notes:[[1046.5,0,.28]] },
 { id:'bell', name:'Double bell', detail:'A friendly nudge', icon:'♬', notes:[[659.25,0,.22],[987.77,.19,.35]] },
 { id:'retro', name:'Retro messenger', detail:'That nostalgic hello', icon:'✳', notes:[[784,0,.12],[1046.5,.13,.12],[1318.5,.26,.22]] },
 { id:'drop', name:'Water drop', detail:'Light & rounded', icon:'♧', notes:[[1568,0,.2],[784,.075,.26]] }
];
export class SoundPlayer {
 constructor({ soundUrl }) { this.soundUrl = soundUrl; this.context = null; this.custom = null; this.customVersion = ''; this.voices = new Set(); }
 async unlock() { this.context ||= new AudioContext(); if (this.context.state === 'suspended') await this.context.resume(); }
 async loadCustom(version) {
  await this.unlock();
  if (!this.custom || this.customVersion !== version) {
   const response = await fetch(this.soundUrl, { cache:'no-store' }); if (!response.ok) throw new Error('Import a custom sound first.');
   this.custom = await this.context.decodeAudioData(await response.arrayBuffer()); this.customVersion = version;
  }
  return this.custom;
 }
 async validateFile(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a sound smaller than 10 MB.');
  await this.unlock(); let buffer;
  try { buffer = await this.context.decodeAudioData(await file.arrayBuffer()); } catch { throw new Error('This audio file cannot be played. Try WAV, MP3 or OGG.'); }
  if (buffer.duration > 10) throw new Error('Choose a short sound of 10 seconds or less.');
 }
 async play(settings, force = false) {
  if (!force && settings.muted) return;
  await this.unlock(); const ctx = this.context;
  if (settings.sound === 'custom') {
   const buffer = await this.loadCustom(settings.customName); const source = ctx.createBufferSource(); source.buffer = buffer;
   const gain = ctx.createGain(); gain.gain.value = settings.volume / 100; source.connect(gain); gain.connect(ctx.destination);
   this.track(source, gain); source.start(); source.stop(ctx.currentTime + Math.min(10, buffer.duration)); return;
  }
  const sound = sounds.find(s => s.id === settings.sound) || sounds[0];
  for (const [frequency, delay, length] of sound.notes) {
   const source = ctx.createOscillator(); const gain = ctx.createGain(); const now = ctx.currentTime + delay;
   source.type = 'sine'; source.frequency.setValueAtTime(frequency, now);
   gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(.0001, settings.volume / 100 * .26), now + .008); gain.gain.exponentialRampToValueAtTime(.0001, now + length);
   source.connect(gain); gain.connect(ctx.destination); this.track(source, gain); source.start(now); source.stop(now + length + .02);
  }
 }
 track(source, gain) {
  // Prevent unbounded overlapping audio during a very busy chat.
  while (this.voices.size >= 24) { const oldest = this.voices.values().next().value; this.voices.delete(oldest); try { oldest.stop(); } catch {} }
  this.voices.add(source); source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
 }
}
