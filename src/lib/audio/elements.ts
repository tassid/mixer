/*
 * Elementos de transição, todos sintetizados aqui (sem samples de terceiros).
 * Cada um é posicionado em relação ao tempo 1 de entrada da próxima música (t).
 */
import type { ElementKind } from "./types";

export interface ElementContext {
  ctx: BaseAudioContext;
  bus: AudioNode;
  noise: AudioBuffer;
  reverb: AudioBuffer;
  t: number; // tempo 1 da próxima música
  beat: number;
  bar: number;
  /** música que está saindo: para glitch e vinyl stop */
  out?: { buffer: AudioBuffer; contentEnd: number; vol: number };
}

/** Até quando a música que sai deve tocar normalmente (glitch e vinyl stop assumem o final). */
export function outgoingCut(kinds: ElementKind[], t: number, beat: number, bar: number): number | null {
  if (kinds.includes("glitch")) return t - beat;
  if (kinds.includes("vinylstop")) return t - bar / 4;
  return null;
}

function env(p: AudioParam, points: [number, number][], exp = false) {
  p.setValueAtTime(points[0][1], points[0][0]);
  for (const [time, v] of points.slice(1)) {
    if (exp) p.exponentialRampToValueAtTime(Math.max(0.0001, v), time);
    else p.linearRampToValueAtTime(v, time);
  }
}

function noiseSrc(c: ElementContext, start: number, stop: number) {
  const s = c.ctx.createBufferSource();
  s.buffer = c.noise; s.loop = true;
  s.start(start); s.stop(stop);
  return s;
}

function withVerb(c: ElementContext, node: AudioNode, amount: number) {
  const conv = c.ctx.createConvolver(), g = c.ctx.createGain();
  conv.buffer = c.reverb; g.gain.value = amount;
  node.connect(conv).connect(g).connect(c.bus);
}

const builders: Record<ElementKind, (c: ElementContext) => void> = {
  shutter(c) {
    const { ctx, t } = c;
    const click = (at: number, f: number, level: number) => {
      const n = noiseSrc(c, at, at + 0.06), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 1.2;
      env(g.gain, [[at, 0.0001], [at + 0.002, level], [at + 0.045, 0.0001]], true);
      n.connect(bp).connect(g).connect(c.bus);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = f * 0.7;
      env(og.gain, [[at, 0.0001], [at + 0.001, level * 0.4], [at + 0.012, 0.0001]], true);
      o.connect(og).connect(c.bus); o.start(at); o.stop(at + 0.02);
      withVerb(c, g, 0.25);
    };
    click(t - 0.005, 2600, 0.9);
    click(t + 0.075, 1900, 0.7);
  },
  flash(c) {
    const { ctx, t } = c;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1400, t - 0.7); o.frequency.exponentialRampToValueAtTime(9500, t);
    env(og.gain, [[t - 0.7, 0.0001], [t - 0.05, 0.08], [t, 0.0001]], true);
    o.connect(og).connect(c.bus); o.start(t - 0.7); o.stop(t + 0.01);
    const n = noiseSrc(c, t, t + 0.2), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = "highpass"; hp.frequency.value = 3500;
    env(g.gain, [[t, 0.0001], [t + 0.002, 0.8], [t + 0.12, 0.0001]], true);
    n.connect(hp).connect(g).connect(c.bus);
    const ping = ctx.createOscillator(), pg = ctx.createGain();
    ping.frequency.value = 5200;
    env(pg.gain, [[t, 0.0001], [t + 0.003, 0.2], [t + 0.35, 0.0001]], true);
    ping.connect(pg).connect(c.bus); ping.start(t); ping.stop(t + 0.4);
    withVerb(c, g, 0.5);
  },
  whoosh(c) {
    const { ctx, t, beat } = c;
    const s = t - beat, e = t + 0.2;
    const n = noiseSrc(c, s, e), bp = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createStereoPanner();
    bp.type = "bandpass"; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(300, s); bp.frequency.exponentialRampToValueAtTime(6500, t);
    env(g.gain, [[s, 0.0001], [t - 0.02, 0.55], [e, 0.0001]], true);
    pan.pan.setValueAtTime(-0.9, s); pan.pan.linearRampToValueAtTime(0.9, e);
    n.connect(bp).connect(g).connect(pan).connect(c.bus);
  },
  riser(c) {
    const { ctx, t, bar } = c;
    const s = t - 2 * bar;
    const n = noiseSrc(c, s, t), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(500, s); bp.frequency.exponentialRampToValueAtTime(8000, t);
    env(g.gain, [[s, 0.0001], [t - 0.01, 0.28]], true); g.gain.linearRampToValueAtTime(0, t);
    n.connect(bp).connect(g).connect(c.bus);
    const o = ctx.createOscillator(), og = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = "sawtooth"; lp.type = "lowpass"; lp.frequency.value = 3000;
    o.frequency.setValueAtTime(180, s); o.frequency.exponentialRampToValueAtTime(1500, t);
    env(og.gain, [[s, 0.0001], [t - 0.01, 0.06]], true); og.gain.linearRampToValueAtTime(0, t);
    o.connect(lp).connect(og).connect(c.bus); o.start(s); o.stop(t + 0.01);
  },
  revcymbal(c) {
    const { ctx, t, bar } = c;
    const s = t - bar;
    const n = noiseSrc(c, s, t), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = "highpass"; hp.frequency.value = 5500;
    env(g.gain, [[s, 0.0001], [t - 0.005, 0.5]], true); g.gain.linearRampToValueAtTime(0, t);
    n.connect(hp).connect(g).connect(c.bus);
  },
  impacto(c) {
    const { ctx, t } = c;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.45);
    env(og.gain, [[t, 0.0001], [t + 0.006, 0.75], [t + 1.1, 0.0001]], true);
    o.connect(og).connect(c.bus); o.start(t); o.stop(t + 1.2);
    const n = noiseSrc(c, t, t + 0.4), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 3200;
    env(g.gain, [[t, 0.0001], [t + 0.004, 0.35], [t + 0.35, 0.0001]], true);
    n.connect(lp).connect(g).connect(c.bus);
    withVerb(c, g, 0.3);
  },
  subdrop(c) {
    const { ctx, t } = c;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    env(og.gain, [[t, 0.0001], [t + 0.01, 0.9], [t + 1.6, 0.0001]], true);
    o.connect(og).connect(c.bus); o.start(t); o.stop(t + 1.7);
  },
  glitch(c) {
    if (!c.out) return;
    const { ctx, t, beat } = c;
    const slice = beat / 4;
    const from = c.out.contentEnd - beat;
    // repete a primeira semicolcheia do último tempo, cada vez mais curta
    const reps = [slice, slice, slice / 2, slice / 2, slice / 2, slice / 2];
    let at = t - beat;
    for (const len of reps) {
      if (at + len > t) break;
      const s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = c.out.buffer;
      env(g.gain, [[at, 0], [at + 0.003, c.out.vol], [at + len - 0.004, c.out.vol], [at + len, 0]]);
      s.connect(g).connect(c.bus);
      s.start(at, from, len);
      at += len;
    }
  },
  vinylstop(c) {
    if (!c.out) return;
    const { ctx, t, bar } = c;
    const start = t - bar / 4;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = c.out.buffer;
    s.playbackRate.setValueAtTime(1, start); s.playbackRate.linearRampToValueAtTime(0.08, t);
    env(g.gain, [[start, c.out.vol], [t - 0.03, c.out.vol * 0.8], [t, 0]]);
    s.connect(g).connect(c.bus);
    s.start(start, c.out.contentEnd - bar / 4);
    s.stop(t + 0.01);
  }
};

export function placeElements(kinds: ElementKind[], c: ElementContext) {
  for (const k of kinds) builders[k]?.(c);
}
