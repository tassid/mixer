import { Plan } from "./plan";
import { stretchRamp } from "./stretch";
import { SR } from "./types";

function noiseBuffer(ctx: BaseAudioContext, sec: number) {
  const n = Math.floor(sec * SR), b = ctx.createBuffer(2, n, SR);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
  return b;
}

function impulse(ctx: BaseAudioContext) {
  const n = Math.floor(2.8 * SR), b = ctx.createBuffer(2, n, SR);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
  return b;
}

function reversedSlice(buf: AudioBuffer, from: number, dur: number): AudioBuffer {
  const a = Math.max(0, Math.floor(from * buf.sampleRate));
  const n = Math.max(1, Math.min(buf.length - a, Math.floor(dur * buf.sampleRate)));
  const out = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: buf.sampleRate });
  for (let c = 0; c < 2; c++) {
    const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)), d = out.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = src[a + n - 1 - i];
  }
  return out;
}

/** Corta o silêncio do fim, deixando um respiro curto. */
function trimTail(buf: AudioBuffer): AudioBuffer {
  let last = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > 0.0015) { last = i; break; }
  }
  const len = Math.min(buf.length, last + Math.floor(0.25 * buf.sampleRate));
  if (len >= buf.length || len <= 0) return buf;
  const out = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(0, len), c);
  return out;
}

function hardEnd(p: AudioParam, v: number, t: number) {
  p.setValueAtTime(v, Math.max(0, t - 0.012));
  p.linearRampToValueAtTime(0, t);
}

function impactAt(ctx: BaseAudioContext, bus: AudioNode, nb: AudioBuffer, t: number) {
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.45);
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.75, t + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(og).connect(bus); o.start(t); o.stop(t + 1.2);
  const ns = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
  ns.buffer = nb; lp.type = "lowpass"; lp.frequency.value = 3200;
  ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.35, t + 0.004); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  ns.connect(lp).connect(ng).connect(bus); ns.start(t); ns.stop(t + 0.4);
}

/** Renderiza o plano inteiro offline (mais rápido que tempo real) e normaliza o pico em -1 dB. */
export async function renderPlan(plan: Plan): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(plan.total * SR), SR);
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.15;
  bus.connect(comp).connect(ctx.destination);
  const nb = noiseBuffer(ctx, 2), ir = impulse(ctx);

  for (const e of plan.entries) {
    const { track, seg, T, gain: vol, end } = e;
    const bar = seg.bar, beat = seg.spb;
    const src = ctx.createBufferSource(); src.buffer = track.buffer;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 10; hp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(hp).connect(g).connect(bus);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(vol, T + 0.008);
    if (e.impact) impactAt(ctx, bus, nb, T);
    src.start(T, seg.t0);

    switch (e.exit) {
      case "fade": {
        const s = Math.max(T + 0.05, end - 2 * bar);
        g.gain.setValueAtTime(vol, s); g.gain.linearRampToValueAtTime(0, end); src.stop(end + 0.02);
        break;
      }
      case "vocal": {
        const s = Math.max(T + 0.05, end - 2 * bar);
        hp.frequency.setValueAtTime(10, s); hp.frequency.exponentialRampToValueAtTime(1200, end);
        const send = ctx.createGain(), conv = ctx.createConvolver(), out = ctx.createGain();
        conv.buffer = ir;
        send.gain.setValueAtTime(0, s); send.gain.linearRampToValueAtTime(0.9 * vol, end);
        out.gain.setValueAtTime(0.8, T); out.gain.setValueAtTime(0.8, e.next); out.gain.linearRampToValueAtTime(0, e.next + 0.3);
        hp.connect(send).connect(conv).connect(out).connect(bus);
        g.gain.setValueAtTime(vol, s); g.gain.linearRampToValueAtTime(vol * 0.55, end - 0.012); g.gain.linearRampToValueAtTime(0, end);
        src.stop(end + 0.02);
        break;
      }
      case "riser": {
        const s = Math.max(T + 0.05, end - 4 * bar);
        hp.frequency.setValueAtTime(10, s); hp.frequency.exponentialRampToValueAtTime(2500, end);
        g.gain.setValueAtTime(vol, s); g.gain.linearRampToValueAtTime(vol * 1.15, end - 0.012); g.gain.linearRampToValueAtTime(0, end);
        const ns = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        ns.buffer = nb; ns.loop = true; bp.type = "bandpass"; bp.Q.value = 0.9;
        bp.frequency.setValueAtTime(400, s); bp.frequency.exponentialRampToValueAtTime(7500, end);
        ng.gain.setValueAtTime(0.0001, s); ng.gain.exponentialRampToValueAtTime(0.3, end - 0.012); ng.gain.linearRampToValueAtTime(0, end);
        ns.connect(bp).connect(ng).connect(bus); ns.start(s); ns.stop(end + 0.02);
        src.stop(end + 0.02);
        break;
      }
      case "echo": {
        const send = ctx.createGain(), dl = ctx.createDelay(4), fb = ctx.createGain(), ehp = ctx.createBiquadFilter(), out = ctx.createGain();
        dl.delayTime.value = beat; fb.gain.value = 0.5; ehp.type = "highpass"; ehp.frequency.value = 350;
        send.gain.setValueAtTime(0, T); send.gain.setValueAtTime(0, end - beat); send.gain.linearRampToValueAtTime(1, end - beat + 0.01);
        send.gain.setValueAtTime(1, end - 0.012); send.gain.linearRampToValueAtTime(0, end);
        out.gain.setValueAtTime(0.85 * vol, T); out.gain.setValueAtTime(0.85 * vol, e.next); out.gain.linearRampToValueAtTime(0, e.next + bar);
        hp.connect(send).connect(dl); dl.connect(fb).connect(dl); dl.connect(ehp).connect(out).connect(bus);
        hardEnd(g.gain, vol, end); src.stop(end + 0.02);
        break;
      }
      case "rewind": {
        const cut = T + (e.tm.cut ?? 0), Tr = e.tm.tr ?? 0.3;
        hardEnd(g.gain, vol, cut); src.stop(cut + 0.02);
        const r = ctx.createBufferSource(), rg = ctx.createGain();
        r.buffer = reversedSlice(track.buffer, seg.t0 + seg.len - bar, bar);
        r.playbackRate.setValueAtTime(1, cut); r.playbackRate.linearRampToValueAtTime(4, cut + Tr);
        rg.gain.setValueAtTime(vol, cut); rg.gain.setValueAtTime(vol, cut + Tr * 0.7); rg.gain.linearRampToValueAtTime(0, cut + Tr);
        r.connect(rg).connect(bus); r.start(cut); r.stop(cut + Tr + 0.01);
        break;
      }
      case "rampa": {
        // trecho final esticado pelo SoundTouch: o andamento sobe sem mudar o tom
        const rs = T + (e.tm.rs ?? 0);
        const N = Math.min(4, seg.bars);
        hardEnd(g.gain, vol, rs + 0.006); src.stop(rs + 0.03);
        const ramp = stretchRamp(track.buffer, seg.t0 + seg.len - N * bar, N * bar, 1, e.ratio);
        const rsrc = ctx.createBufferSource(), rg = ctx.createGain();
        rsrc.buffer = ramp;
        rg.gain.setValueAtTime(0, rs); rg.gain.linearRampToValueAtTime(vol, rs + 0.006);
        rsrc.connect(rg).connect(bus);
        hardEnd(rg.gain, vol, end);
        rsrc.start(rs); rsrc.stop(end + 0.02);
        break;
      }
      default: {
        hardEnd(g.gain, vol, end); src.stop(end + 0.02);
      }
    }
  }

  const out = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  if (peak > 0) {
    const k = 0.891 / peak;
    for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  }
  return trimTail(out);
}
