/* Pilot sounds, all generated with Web Audio: underwater ambience, motor whine and prop wash, bubbles, bumps and splashes. */
(function () {
  const U = window.UIVD;
  let ctx = null, master, amb, ambFilter, ambGain, ambLfo, motorOsc1, motorOsc2, motorBand, motorGain, motorFilter, wash, washGain, noiseBuf;
  let enabled = true, bubbleT = 0;

  function makeNoise(c, seconds, brown) {
    const n = Math.floor(c.sampleRate * seconds), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function loopNoise(buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }

  // Build the sound graph. Must be called from a tap or key press (browser autoplay rules).
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; return null; }
    master = ctx.createGain(); master.gain.value = enabled ? 0.7 : 0; master.connect(ctx.destination);
    noiseBuf = makeNoise(ctx, 3, false);
    const brownBuf = makeNoise(ctx, 4, true);

    // ambience: brown noise, low-passed, with a slow surge
    amb = loopNoise(brownBuf);
    ambFilter = ctx.createBiquadFilter(); ambFilter.type = 'lowpass'; ambFilter.frequency.value = 450;
    ambGain = ctx.createGain(); ambGain.gain.value = 0;
    ambLfo = ctx.createOscillator(); ambLfo.frequency.value = 0.12;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.05;
    ambLfo.connect(lfoDepth); lfoDepth.connect(ambGain.gain); ambLfo.start();
    amb.connect(ambFilter); ambFilter.connect(ambGain); ambGain.connect(master);

    // motor: two detuned oscillators through a resonant band, then a muffling low-pass
    motorOsc1 = ctx.createOscillator(); motorOsc1.type = 'sawtooth'; motorOsc1.frequency.value = 140;
    motorOsc2 = ctx.createOscillator(); motorOsc2.type = 'square'; motorOsc2.frequency.value = 211;
    const o2g = ctx.createGain(); o2g.gain.value = 0.35;
    motorBand = ctx.createBiquadFilter(); motorBand.type = 'bandpass'; motorBand.frequency.value = 420; motorBand.Q.value = 2.5;
    motorGain = ctx.createGain(); motorGain.gain.value = 0;
    motorFilter = ctx.createBiquadFilter(); motorFilter.type = 'lowpass'; motorFilter.frequency.value = 1100;
    motorOsc1.connect(motorBand); motorOsc2.connect(o2g); o2g.connect(motorBand);
    motorBand.connect(motorGain); motorGain.connect(motorFilter); motorFilter.connect(master);
    motorOsc1.start(); motorOsc2.start();

    // prop wash: white noise through a band
    wash = loopNoise(noiseBuf);
    const washBand = ctx.createBiquadFilter(); washBand.type = 'bandpass'; washBand.frequency.value = 650; washBand.Q.value = 0.8;
    washGain = ctx.createGain(); washGain.gain.value = 0;
    wash.connect(washBand); washBand.connect(washGain); washGain.connect(master);

    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (enabled) ctx.resume(); });
    return ctx;
  }

  function setEnabled(on) {
    enabled = on;
    if (!ctx) return;
    master.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.05);
    if (on && ctx.state === 'suspended') ctx.resume();
  }

  // Called every frame while piloting. s: { active, underwater, motors: [{ out, wet }], volts, speed }
  function update(s, dt) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime, k = 0.12;
    if (!s.active) {
      ambGain.gain.setTargetAtTime(0, t, 0.3); motorGain.gain.setTargetAtTime(0, t, 0.1); washGain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    // ambience: muffled rumble under water, lighter lapping above
    ambFilter.frequency.setTargetAtTime(s.underwater ? 420 : 2600, t, 0.3);
    ambGain.gain.setTargetAtTime(s.underwater ? 0.13 : 0.05, t, 0.4);
    // motors
    let n = 0, dry = 0;
    s.motors.forEach(m => { const a = Math.abs(m.out); n += a; if (!m.wet) dry += a; });
    const load = n ? 1 - 0.45 * (dry / n) : 1; // a motor out of the water spins faster (no load)
    const v = Math.max(0.3, s.volts / 12);
    const f = (95 + 45 * v) / load;
    motorOsc1.frequency.setTargetAtTime(f, t, k);
    motorOsc2.frequency.setTargetAtTime(f * 1.505, t, k);
    motorBand.frequency.setTargetAtTime(f * 3, t, k);
    motorFilter.frequency.setTargetAtTime(s.underwater ? 900 : 3200, t, 0.2);
    const level = n ? Math.min(0.26, 0.09 * Math.pow(n, 0.7)) : 0;
    motorGain.gain.setTargetAtTime(level * (dry ? 1.3 : 1), t, n ? k : 0.25);
    washGain.gain.setTargetAtTime(n ? Math.min(0.16, 0.06 * Math.pow(n - dry, 0.7) + 0.02 * s.speed) : 0, t, n ? k : 0.3);
    // bubbles: a few drifting past, more while the props spin
    if (s.underwater) {
      bubbleT -= dt;
      if (bubbleT <= 0) { bubble(0.6 + Math.random() * 0.6); bubbleT = (0.25 + Math.random() * 1.6) / (1 + 2.5 * (n - dry)); }
    }
  }

  function bubble(size) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f0 = 300 + Math.random() * 500 / size;
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.06);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035 * size, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.1);
  }

  // A bump against the floor, a wall or the apparatus. strength 0..1
  function thud(strength) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime, a = Math.max(0.05, Math.min(1, strength));
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    g.gain.setValueAtTime(0.5 * a, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.32);
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.35 * a, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(lp); lp.connect(ng); ng.connect(master); n.start(t, Math.random() * 2); n.stop(t + 0.16);
  }

  // Breaking the surface. strength 0..1
  function splash(strength) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime, a = Math.max(0.1, Math.min(1, strength));
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.setValueAtTime(2500, t); hp.frequency.exponentialRampToValueAtTime(700, t + 0.4); hp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28 * a, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(hp); hp.connect(g); g.connect(master); n.start(t, Math.random() * 2); n.stop(t + 0.52);
  }

  U.Audio = { init, setEnabled, update, thud, splash, ctx: () => ctx, master: () => master };
})();
