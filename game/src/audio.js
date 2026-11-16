// All sound is synthesised: oscillators and one preallocated noise buffer
// through a single gain node. No audio files, no network. The context is
// created on the first user gesture (the play click), and every call is a
// no-op until then, so screenshot mode stays silent and deterministic.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // Distance attenuation shared by world sounds: 1 at the listener, 0 past 40 m.
  function atten(dist) {
    return Math.max(0, 1 - dist / 40);
  }

  return {
    unlock: ensure,
    shot(kind, dist) {
      const v = 0.25 + atten(dist || 0) * 0.75;
      if (kind === 'pistol') { noise(0.09, 0.5 * v, 3200); tone(180, 0.07, 'square', 0.12 * v, 60); }
      else if (kind === 'smg') { noise(0.07, 0.4 * v, 4200); tone(220, 0.05, 'square', 0.1 * v, 70); }
      else { noise(0.11, 0.55 * v, 2600); tone(140, 0.09, 'sawtooth', 0.14 * v, 50); }
    },
    dryFire() { tone(1400, 0.04, 'square', 0.08); },
    reload() { tone(700, 0.05, 'square', 0.1); setTimeout(() => tone(500, 0.05, 'square', 0.1), 260); },
    hit() { tone(2100, 0.05, 'sine', 0.22); },
    kill() { tone(1560, 0.07, 'sine', 0.22); setTimeout(() => tone(2100, 0.09, 'sine', 0.22), 70); },
    hurt() { tone(110, 0.12, 'sawtooth', 0.2, 60); },
    explode(dist) {
      const v = 0.3 + atten(dist || 0) * 0.7;
      noise(0.9, 0.9 * v, 500);
      tone(70, 0.8, 'sine', 0.7 * v, 28);
    },
    beep(fast) { tone(fast ? 1750 : 1250, 0.06, 'sine', 0.2); },
    plant() { tone(880, 0.1, 'sine', 0.25); setTimeout(() => tone(1320, 0.14, 'sine', 0.25), 110); },
    click() { tone(900, 0.04, 'square', 0.08); },
    bounce() { tone(340, 0.05, 'triangle', 0.14, 180); },
    roundWin() { tone(660, 0.12, 'sine', 0.22); setTimeout(() => tone(990, 0.2, 'sine', 0.22), 120); },
    roundLose() { tone(330, 0.16, 'sine', 0.22); setTimeout(() => tone(220, 0.26, 'sine', 0.22), 150); },
  };
}
