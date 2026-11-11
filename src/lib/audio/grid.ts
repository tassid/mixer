import type { Analysis, BeatMul, Track } from "./types";

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

export function medianSpb(beats: number[]): number {
  if (beats.length < 2) return 0.5;
  const d = beats.slice(1).map((v, i) => v - beats[i]).sort((x, y) => x - y);
  return d[Math.floor(d.length / 2)];
}

export function beatAt(beats: number[], i: number): number {
  if (i < beats.length) return beats[Math.max(0, i)];
  return beats[beats.length - 1] + (i - beats.length + 1) * medianSpb(beats);
}


export function downbeatTimeRaw(t: Pick<Track, "analysis" | "beatMul" | "phase">, j: number): number {
  return beatAt(beatsOf(t), t.phase + 4 * j);
}
