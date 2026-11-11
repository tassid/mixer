import { Plan } from "./plan";
import { outgoingCut, placeElements } from "./elements";
import { stretchedDuration, stretchPieces } from "./stretch";
import type { PlanEntry } from "./plan";
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

function outgoingCutTime(e: PlanEntry, beat: number, bar: number): number | null {
  if (e.exit === "rewind") return null;
  return outgoingCut(e.fx, e.swap, beat, bar);
}

function hardEnd(p: AudioParam, v: number, t: number) {
  p.setValueAtTime(v, Math.max(0, t - 0.012));
  p.linearRampToValueAtTime(0, t);
}

/** Renderiza o plano inteiro offline (mais rápido que tempo real) e normaliza o pico em -1 dB. */
export async function renderPlan(plan: Plan): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(plan.total * SR), SR);
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.15;
  bus.connect(comp).connect(ctx.destination);
  const fxBus = ctx.createGain(); fxBus.gain.value = 0.8; fxBus.connect(bus);
  const nb = noiseBuffer(ctx, 2), ir = impulse(ctx);

  plan.entries.forEach((e, i) => {
    const { track, seg, T, gain: vol, end, swap } = e;
    const bar = e.barOut, beat = e.beatOut;
    const nextEntry = plan.entries[i + 1];
    const rOut = e.outBridge?.rate ?? 1;
    const segEnd = seg.t0 + seg.len;

    /* ----- entrada por baixo (mixagem DJ): no BPM da anterior, sem graves ----- */
    if (e.preroll) {
      const pr = e.preroll;
      const content = pr.bars * seg.bar;
      const buf = stretchPieces(track.buffer, seg.t0 - content, [{ content, r0: pr.rate, r1: pr.rate }]);
      const src = ctx.createBufferSource(), shelf = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf;
      shelf.type = "lowshelf"; shelf.frequency.value = 220; shelf.gain.value = -40;
      const overlap = T - pr.start;
      g.gain.setValueAtTime(0, pr.start);
      g.gain.linearRampToValueAtTime(vol * 0.5, pr.start + overlap * 0.5);
      g.gain.linearRampToValueAtTime(vol * 0.85, T - 0.006);
      g.gain.linearRampToValueAtTime(0, T);
      src.connect(shelf).connect(g).connect(bus);
      src.start(pr.start);
      src.stop(T + 0.01);
    }

    /* ----- cadeia da música: graves, filtro, volume e corte ----- */
    const shelf = ctx.createBiquadFilter(); shelf.type = "lowshelf"; shelf.frequency.value = 220; shelf.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 10; hp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    const gate = ctx.createGain(); gate.gain.value = 1;
    shelf.connect(hp).connect(g).connect(gate).connect(bus);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(vol, T + 0.006);

    const play = (buf: AudioBuffer, at: number) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.connect(shelf); s.start(at); return s;
    };
    // 1) começo: rampa do BPM de entrada até o BPM original
    const Kin = e.inBridge?.bars ?? 0;
    if (Kin) play(stretchPieces(track.buffer, seg.t0, [{ content: Kin * seg.bar, r0: e.inBridge!.rate, r1: 1 }]), T);
    // 2) meio no BPM original
    const midFrom = seg.t0 + Kin * seg.bar;
    const midDur = e.tailStart - e.midStart;
    const tailSrcStart = e.tailStart;
    if (midDur > 0.01) {
      const s = ctx.createBufferSource(); s.buffer = track.buffer; s.connect(shelf);
      s.start(e.midStart, midFrom, midDur + 0.004);
    }
    // 3) final: rampa até o BPM de saída, sobreposição e cauda, tudo com key lock
    const Kout = e.outBridge?.bars ?? 0;
    const pieces = [];
    if (Kout) pieces.push({ content: Kout * seg.bar, r0: 1, r1: rOut });
    const constContent = e.overlapBars * seg.bar + e.tailContent;
    if (constContent > 0.01) pieces.push({ content: constContent, r0: rOut, r1: rOut });
    if (pieces.length) {
      const from = segEnd - (Kout + e.overlapBars) * seg.bar;
      play(stretchPieces(track.buffer, from, pieces), tailSrcStart);
    }

    /* elementos da transição que sai desta música */
    if (nextEntry && e.fx.length) {
      const cut = outgoingCutTime(e, beat, bar);
      if (cut !== null) hardEnd(gate.gain, 1, cut);
      placeElements(e.fx, {
        ctx, bus: fxBus, noise: nb, reverb: ir, t: swap, beat, bar,
        out: { buffer: track.buffer, contentEnd: segEnd, vol }
      });
    }

    const segEndTime = e.tailStart + (Kout ? stretchedDuration(Kout * seg.bar, 1, rOut) : 0) + e.overlapBars * seg.bar / rOut;
    switch (e.exit) {
      case "blend": {
        const ov = nextEntry?.preroll ? swap - nextEntry.preroll.start : bar;
        hp.frequency.setValueAtTime(10, swap - ov * 0.5);
        hp.frequency.exponentialRampToValueAtTime(140, swap);
        shelf.gain.setValueAtTime(0, swap - 0.01);
        shelf.gain.linearRampToValueAtTime(-40, swap + beat * 0.25);
        g.gain.setValueAtTime(vol, swap);
        g.gain.linearRampToValueAtTime(0, end);
        hp.frequency.exponentialRampToValueAtTime(900, end);
        break;
      }
      case "fade": {
        const s = Math.max(T + 0.05, end - 2 * bar);
        g.gain.setValueAtTime(vol, s); g.gain.linearRampToValueAtTime(0, end);
        break;
      }
      case "vocal": {
        const s = Math.max(T + 0.05, segEndTime - 2 * bar);
        hp.frequency.setValueAtTime(10, s); hp.frequency.exponentialRampToValueAtTime(1200, segEndTime);
        const send = ctx.createGain(), conv = ctx.createConvolver(), out = ctx.createGain();
        conv.buffer = ir;
        send.gain.setValueAtTime(0, s); send.gain.linearRampToValueAtTime(0.9 * vol, segEndTime);
        out.gain.setValueAtTime(0.8, T); out.gain.setValueAtTime(0.8, swap); out.gain.linearRampToValueAtTime(0, swap + 0.3);
        hp.connect(send).connect(conv).connect(out).connect(bus);
        g.gain.setValueAtTime(vol, s); g.gain.linearRampToValueAtTime(vol * 0.55, segEndTime - 0.012); g.gain.linearRampToValueAtTime(0, segEndTime);
        break;
      }
      case "riser": {
        const s = Math.max(T + 0.05, segEndTime - 4 * bar);
        hp.frequency.setValueAtTime(10, s); hp.frequency.exponentialRampToValueAtTime(2500, segEndTime);
        g.gain.setValueAtTime(vol, s); g.gain.linearRampToValueAtTime(vol * 1.15, segEndTime - 0.012); g.gain.linearRampToValueAtTime(0, segEndTime);
        const ns = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        ns.buffer = nb; ns.loop = true; bp.type = "bandpass"; bp.Q.value = 0.9;
        bp.frequency.setValueAtTime(400, s); bp.frequency.exponentialRampToValueAtTime(7500, segEndTime);
        ng.gain.setValueAtTime(0.0001, s); ng.gain.exponentialRampToValueAtTime(0.3, segEndTime - 0.012); ng.gain.linearRampToValueAtTime(0, segEndTime);
        ns.connect(bp).connect(ng).connect(bus); ns.start(s); ns.stop(segEndTime + 0.02);
        break;
      }
      case "echo": {
        const send = ctx.createGain(), dl = ctx.createDelay(4), fb = ctx.createGain(), ehp = ctx.createBiquadFilter(), out = ctx.createGain();
        dl.delayTime.value = beat; fb.gain.value = 0.5; ehp.type = "highpass"; ehp.frequency.value = 350;
        send.gain.setValueAtTime(0, T); send.gain.setValueAtTime(0, segEndTime - beat); send.gain.linearRampToValueAtTime(1, segEndTime - beat + 0.01);
        send.gain.setValueAtTime(1, segEndTime - 0.012); send.gain.linearRampToValueAtTime(0, segEndTime);
        out.gain.setValueAtTime(0.85 * vol, T); out.gain.setValueAtTime(0.85 * vol, swap); out.gain.linearRampToValueAtTime(0, swap + bar);
        hp.connect(send).connect(dl); dl.connect(fb).connect(dl); dl.connect(ehp).connect(out).connect(bus);
        hardEnd(g.gain, vol, segEndTime);
        break;
      }
      case "rewind": {
        const cut = segEndTime - bar / 2, Tr = 0.35 * bar;
        hardEnd(g.gain, vol, cut);
        const r = ctx.createBufferSource(), rg = ctx.createGain();
        r.buffer = reversedSlice(track.buffer, segEnd - seg.bar, seg.bar);
        r.playbackRate.setValueAtTime(1, cut); r.playbackRate.linearRampToValueAtTime(4, cut + Tr);
        rg.gain.setValueAtTime(vol, cut); rg.gain.setValueAtTime(vol, cut + Tr * 0.7); rg.gain.linearRampToValueAtTime(0, cut + Tr);
        r.connect(rg).connect(bus); r.start(cut); r.stop(cut + Tr + 0.01);
        break;
      }
      default: {
        hardEnd(g.gain, vol, segEndTime);
      }
    }
  });

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
