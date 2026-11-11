import { Analysis, SR, Segment, Track } from "./types";
import { beatAt, beatsOf, medianSpb } from "./grid";
import { bestStart } from "./structure";

export { beatsOf } from "./grid";

/* ---------- comunicação com o worker ---------- */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (a: Analysis) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data as Analysis);
    };
    worker.onerror = (e) => {
      pending.forEach((p) => p.reject(new Error(e.message || "Falha no analisador")));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

export function analyzeBuffer(buffer: AudioBuffer): Promise<Analysis> {
  const n = buffer.length;
  const mono = new Float32Array(n);
  const c0 = buffer.getChannelData(0);
  const c1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : c0;
  for (let i = 0; i < n; i++) mono[i] = (c0[i] + c1[i]) * 0.5;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, mono, sampleRate: buffer.sampleRate }, [mono.buffer]);
  });
}

/* ---------- grade de batidas ---------- */
function interp(a: Float32Array, t: number) {
  const i = Math.floor(t);
  if (i < 0) return a[0] ?? 0;
  if (i >= a.length - 1) return a[a.length - 1] ?? 0;
  return a[i] + (a[i + 1] - a[i]) * (t - i);
}

export function bpmOf(t: Pick<Track, "analysis" | "beatMul">): number {
  return 60 / medianSpb(beatsOf(t));
}

/** Qual das 4 posições do compasso tem o grave mais forte: esse é o tempo 1. */
export function detectPhase(t: Pick<Track, "analysis" | "beatMul">): number {
  const beats = beatsOf(t);
  const { lowOnset, fps } = t.analysis;
  const sc = [0, 0, 0, 0];
  beats.forEach((b, k) => { sc[k % 4] += interp(lowOnset, b * fps); });
  return sc.indexOf(Math.max(...sc));
}

export function downbeatTime(t: Track, j: number): number {
  return beatAt(beatsOf(t), t.phase + 4 * j);
}

export function maxStart(t: Track): number {
  const beats = beatsOf(t);
  let j = 0;
  while (beatAt(beats, t.phase + 4 * (j + 1 + t.bars)) <= t.duration) j++;
  return j;
}

/** Melhor trecho: o que mais se repete (refrão) com energia alta, alinhado às frases de 4 compassos. */
export function autoStart(t: Track): number {
  return Math.min(maxStart(t), bestStart(t, t.bars));
}

export function nearestDownbeat(t: Track, time: number): number {
  const max = maxStart(t);
  let best = 0, bd = Infinity;
  for (let j = 0; j <= max; j++) {
    const d = Math.abs(downbeatTime(t, j) - time);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

/** Trecho exato, usando as batidas reais (não uma grade fixa). */
export function segmentOf(t: Track): Segment {
  const beats = beatsOf(t);
  const b0 = t.phase + 4 * t.startDown;
  let bars = t.bars;
  while (bars > 1 && beatAt(beats, b0 + 4 * bars) > t.duration) bars--;
  const t0 = beatAt(beats, b0);
  const t1 = Math.min(beatAt(beats, b0 + 4 * bars), t.duration);
  const len = Math.max(0.5, t1 - t0);
  const spb = len / (4 * bars);
  return { t0, len, bpm: 60 / spb, spb, bar: 4 * spb, bars };
}

export function segmentRms(buffer: AudioBuffer, seg: Segment): number {
  const c0 = buffer.getChannelData(0);
  const c1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : c0;
  const a = Math.floor(seg.t0 * buffer.sampleRate);
  const b = Math.min(buffer.length, Math.floor((seg.t0 + seg.len) * buffer.sampleRate));
  let s = 0, c = 0;
  for (let i = a; i < b; i += 4) { const x = (c0[i] + c1[i]) * 0.5; s += x * x; c++; }
  return Math.sqrt(s / Math.max(1, c));
}

/* ---------- decodificação ---------- */
let decodeCtx: AudioContext | null = null;
export async function decodeFile(file: File): Promise<AudioBuffer> {
  if (!decodeCtx) {
    try { decodeCtx = new AudioContext({ sampleRate: SR }); } catch { decodeCtx = new AudioContext(); }
  }
  return decodeCtx.decodeAudioData(await file.arrayBuffer());
}

export function peaksOf(buffer: AudioBuffer, n = 2000): Float32Array {
  const d = buffer.getChannelData(0);
  const out = new Float32Array(n);
  const step = d.length / n;
  for (let p = 0; p < n; p++) {
    let m = 0;
    const s = Math.floor(p * step), e = Math.min(d.length, Math.floor((p + 1) * step));
    for (let i = s; i < e; i += 8) { const v = Math.abs(d[i]); if (v > m) m = v; }
    out[p] = m;
  }
  return out;
}
