import { Analysis, BeatMul, SR, Segment, Track } from "./types";

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

const beatCache = new WeakMap<Analysis, Map<BeatMul, number[]>>();

/** Batidas efetivas, considerando correção de BPM pela metade ou em dobro. */
export function beatsOf(t: Pick<Track, "analysis" | "beatMul">): number[] {
  let m = beatCache.get(t.analysis);
  if (!m) { m = new Map(); beatCache.set(t.analysis, m); }
  const hit = m.get(t.beatMul);
  if (hit) return hit;
  const b = Array.from(t.analysis.beats);
  let out: number[];
  if (t.beatMul === 0.5) out = b.filter((_, i) => i % 2 === 0);
  else if (t.beatMul === 2) {
    out = [];
    for (let i = 0; i < b.length; i++) { out.push(b[i]); if (i < b.length - 1) out.push((b[i] + b[i + 1]) / 2); }
  } else out = b;
  m.set(t.beatMul, out);
  return out;
}

function medianSpb(beats: number[]): number {
  if (beats.length < 2) return 0.5;
  const d = beats.slice(1).map((v, i) => v - beats[i]).sort((x, y) => x - y);
  return d[Math.floor(d.length / 2)];
}

function beatAt(beats: number[], i: number): number {
  if (i < beats.length) return beats[Math.max(0, i)];
  return beats[beats.length - 1] + (i - beats.length + 1) * medianSpb(beats);
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

/** Trecho com mais energia média, alinhado ao tempo 1. */
export function autoStart(t: Track): number {
  const { energyCum, fps } = t.analysis;
  const max = maxStart(t);
  let best = -1, bj = 0;
  for (let j = 0; j <= max; j++) {
    const t0 = downbeatTime(t, j);
    const t1 = downbeatTime(t, j + t.bars);
    if (t0 < 1 || t1 > t.duration) continue;
    const a = Math.floor(t0 * fps), b = Math.min(energyCum.length - 1, Math.floor(t1 * fps));
    const e = (energyCum[b] - energyCum[a]) / Math.max(1, b - a);
    if (e > best) { best = e; bj = j; }
  }
  return bj;
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
