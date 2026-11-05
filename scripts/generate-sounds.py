"""Generate original notification tones. No copyrighted recordings are bundled."""
import math
import pathlib
import struct
import wave
RATE = 44100
NOTES = {
    'chime': [(880, 0, .32), (1320, .13, .42)],
    'ping': [(1046.5, 0, .28)],
    'bell': [(659.25, 0, .22), (987.77, .19, .35)],
    'retro': [(784, 0, .12), (1046.5, .13, .12), (1318.5, .26, .22)],
    'drop': [(1568, 0, .2), (784, .075, .26)],
}
root = pathlib.Path(__file__).resolve().parents[1] / 'obs/data/sounds'
root.mkdir(parents=True, exist_ok=True)
for name, notes in NOTES.items():
    samples = []
    for i in range(int((max(start + duration for _, start, duration in notes) + .03) * RATE)):
        t = i / RATE
        value = 0
        for frequency, start, duration in notes:
            relative = t - start
            if 0 <= relative < duration:
                envelope = min(1, relative / .008) * math.exp(-8 * relative / duration)
                value += .26 * envelope * math.sin(2 * math.pi * frequency * relative)
        samples.append(struct.pack('<h', round(max(-1, min(1, value)) * 32767)))
    with wave.open(str(root / f'{name}.wav'), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(b''.join(samples))
