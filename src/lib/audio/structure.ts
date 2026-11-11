/*
 * Estrutura da música por compasso:
 * timbre (mel) e harmonia (croma) viram um vetor por compasso, a matriz de autossimilaridade
 * mostra onde a música muda (novidade) e o que se repete (refrão).
 */
import type { Analysis, Track } from "./types";
import { downbeatTimeRaw } from "./grid";

export interface Structure {
  times: number[]; // início de cada compasso (tempo 1)
  energy: number[]; // 0 a 1
  rep: number[]; // repetição, 0 a 1
  novelty: number[]; // 0 a 1
  grid: number; // fase das frases de 4 compassos (0 a 3)
  boundaries: number[]; // compassos onde começa uma parte nova
}

const cache = new WeakMap<Analysis, Map<string, Structure>>();

function norm01(a: number[]): number[] {
  const lo = Math.min(...a), hi = Math.max(...a);
  return a.map((v) => (hi - lo > 1e-9 ? (v - lo) / (hi - lo) : 0));
}

function cosine(a: Float64Array, b: Float64Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : 0;
}

export function structureOf(t: Pick<Track, "analysis" | "beatMul" | "phase" | "duration">): Structure {
  let m = cache.get(t.analysis);
  if (!m) { m = new Map(); cache.set(t.analysis, m); }
  const key = `${t.beatMul}:${t.phase}`;
  const hit = m.get(key);
  if (hit) return hit;
  const s = compute(t);
  m.set(key, s);
  return s;
}

function compute(t: Pick<Track, "analysis" | "beatMul" | "phase" | "duration">): Structure {
  const { mel, chroma, specFps, nMel, energyCum, fps } = t.analysis;
  const times: number[] = [];
  for (let j = 0; ; j++) {
    const a = downbeatTimeRaw(t, j);
    if (downbeatTimeRaw(t, j + 1) > t.duration) break;
    times.push(a);
    if (j > 2000) break;
  }
  const n = times.length;
  const empty: Structure = { times, energy: times.map(() => 0), rep: times.map(() => 0), novelty: times.map(() => 0), grid: 0, boundaries: [0] };
  if (n < 8) return empty;
  const nFrames = Math.floor(mel.length / nMel);

  const melV: Float64Array[] = [], chV: Float64Array[] = [], energyRaw: number[] = [];
  for (let j = 0; j < n; j++) {
    const t0 = times[j], t1 = j + 1 < n ? times[j + 1] : downbeatTimeRaw(t, j + 1);
    const a = Math.min(nFrames - 1, Math.floor(t0 * specFps)), b = Math.max(a + 1, Math.min(nFrames, Math.floor(t1 * specFps)));
    const mv = new Float64Array(nMel), cv = new Float64Array(12);
    for (let f = a; f < b; f++) {
      for (let k = 0; k < nMel; k++) mv[k] += mel[f * nMel + k];
      for (let k = 0; k < 12; k++) cv[k] += chroma[f * 12 + k];
    }
    for (let k = 0; k < nMel; k++) mv[k] /= b - a;
    for (let k = 0; k < 12; k++) cv[k] /= b - a;
    melV.push(mv); chV.push(cv);
    const ea = Math.floor(t0 * fps), eb = Math.min(energyCum.length - 1, Math.floor(t1 * fps));
    energyRaw.push((energyCum[eb] - energyCum[ea]) / Math.max(1, eb - ea));
  }
  // padroniza cada dimensão entre compassos
  const standardize = (vs: Float64Array[]) => {
    const d = vs[0].length;
    for (let k = 0; k < d; k++) {
      let mu = 0; for (const v of vs) mu += v[k]; mu /= vs.length;
      let sd = 0; for (const v of vs) sd += (v[k] - mu) ** 2; sd = Math.sqrt(sd / vs.length) || 1;
      for (const v of vs) v[k] = (v[k] - mu) / sd;
    }
  };
  standardize(melV); standardize(chV);

  const S: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    const v = 0.5 * cosine(melV[i], melV[j]) + 0.5 * cosine(chV[i], chV[j]);
    S[i][j] = v; S[j][i] = v;
  }

  // novidade: núcleo em tabuleiro de 4 compassos de cada lado
  const w = 4, nov = new Array(n).fill(0);
  for (let j = w; j <= n - w; j++) {
    let s = 0;
    for (let a = -w; a < w; a++) for (let b = -w; b < w; b++) s += (a < 0 ? -1 : 1) * (b < 0 ? -1 : 1) * S[j + a][j + b];
    nov[j] = Math.max(0, s);
  }
  // repetição: trechos de 4 compassos que reaparecem a 8 ou mais compassos de distância
  const rep = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let best = -1;
    for (let L = 8; L < n; L++) {
      for (const dir of [1, -1]) {
        let s = 0, c = 0;
        for (let k = 0; k < 4; k++) {
          const i = j + k, o = j + k + dir * L;
          if (i < n && o >= 0 && o < n) { s += S[i][o]; c++; }
        }
        if (c >= 3 && s / c > best) best = s / c;
      }
    }
    rep[j] = Math.max(0, best);
  }
  const novN = norm01(nov), repN = norm01(rep), enN = norm01(energyRaw);

  // fase das frases: posição (mod 4) onde a novidade mais acontece
  const g = [0, 0, 0, 0];
  novN.forEach((v, j) => { g[j % 4] += v; });
  const grid = g.indexOf(Math.max(...g));

  const mean = novN.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(novN.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const bset = new Set<number>([grid % 4 === 0 ? 0 : grid]);
  for (let j = 1; j < n - 1; j++) {
    const isPeak = novN[j] >= novN[j - 1] && novN[j] >= novN[j + 1] && novN[j] > mean + 0.5 * sd;
    if (!isPeak) continue;
    const snapped = Math.round((j - grid) / 4) * 4 + grid;
    if (snapped >= 0 && snapped < n) bset.add(snapped);
  }
  const boundaries = [...bset].sort((a, b) => a - b);
  return { times, energy: enN, rep: repN, novelty: novN, grid, boundaries };
}

/** Tamanho da parte que começa no compasso `start`: até a próxima divisa de parte (8 a 32 compassos), em frases de 4. */
export function sectionLength(t: Pick<Track, "analysis" | "beatMul" | "phase" | "duration">, start: number): number {
  const st = structureOf(t);
  const n = st.times.length;
  const room = n - start;
  if (room <= 4) return Math.max(1, room);
  const ends = st.boundaries.filter((e) => e - start >= 8 && e - start <= 32);
  if (ends.length) {
    let best = ends[0], bs = -Infinity;
    for (const e of ends) {
      const L = e - start;
      const s = st.novelty[e] * 0.6 - Math.abs(L - 16) / 32;
      if (s > bs) { bs = s; best = e; }
    }
    return Math.min(room, best - start);
  }
  return Math.max(4, Math.min(16, Math.floor(room / 4) * 4));
}

/** Melhor trecho: começa numa divisa de parte, termina no fim da parte, e é o que mais se repete com energia alta. */
export function bestSegment(t: Pick<Track, "analysis" | "beatMul" | "phase" | "duration">, fixedBars: number): { start: number; bars: number } {
  const st = structureOf(t);
  const n = st.times.length;
  if (n < 9) return { start: 0, bars: fixedBars || Math.max(1, n) };
  const bnd = new Set(st.boundaries);
  let best = -Infinity, res = { start: 0, bars: fixedBars || 8 };
  for (let j = 0; j < n - 4; j++) {
    if ((j - st.grid) % 4 !== 0) continue;
    const bars = fixedBars || sectionLength(t, j);
    if (j + bars > n) continue;
    let r = 0, e = 0;
    for (let k = j; k < j + bars; k++) { r += st.rep[k]; e += st.energy[k]; }
    r /= bars; e /= bars;
    const endsOnBoundary = bnd.has(j + bars) ? 0.08 : 0;
    const score = 0.55 * r + 0.45 * e + (bnd.has(j) ? 0.12 : 0) + endsOnBoundary - (j < 4 ? 0.3 : 0) - (bars < 8 ? 0.2 : 0);
    if (score > best) { best = score; res = { start: j, bars }; }
  }
  return res;
}

export function bestStart(t: Pick<Track, "analysis" | "beatMul" | "phase" | "duration">, bars: number): number {
  return bestSegment(t, bars).start;
}
