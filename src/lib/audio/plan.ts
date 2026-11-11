import { camelot, compat, Compat } from "./keys";
import { segmentOf, segmentRms } from "./analyze";
import { structureOf } from "./structure";
import type { ElementKind, ResolvedExit, Segment, Track } from "./types";

export interface Preroll {
  /** compassos da próxima música tocando por baixo antes do tempo 1 de entrada */
  bars: number;
  /** quando a sobreposição começa no mix */
  start: number;
  /** velocidade aplicada à próxima música durante a sobreposição (BPM da atual / BPM da próxima) */
  tempo: number;
}

export interface PlanEntry {
  track: Track;
  seg: Segment;
  exit: ResolvedExit;
  /** razão de andamento para a rampa (BPM da próxima / BPM desta) */
  ratio: number;
  /** elementos na transição que sai desta música */
  fx: ElementKind[];
  fxAuto: boolean;
  /** esta música entra por baixo da anterior (mixagem DJ) */
  preroll: Preroll | null;
  T: number;
  end: number;
  next: number;
  tm: Timing;
  gain: number;
  keyCompat: Compat | null;
  fellBack: boolean;
}

export interface Timing { end: number; next: number; cut?: number; tr?: number; rs?: number; T?: number; tail?: number }
export interface Plan { entries: PlanEntry[]; total: number }
export interface PlanItem { track: Track; seg?: Segment; exit?: ResolvedExit; fx?: ElementKind[] }

const RAMP_MIN = 0.9, RAMP_MAX = 1.12, BLEND_MAX = 0.08;

type Item = { track: Track; seg: Segment; forced?: ResolvedExit; forcedFx?: ElementKind[] };

function keyCompatOf(a: Track, b: Track): Compat {
  return compat(camelot(a.analysis.key, a.analysis.scale), camelot(b.analysis.key, b.analysis.scale));
}

/** Quantos compassos de sobreposição cabem (antes do trecho da próxima e dentro do trecho atual). */
function fitBlend(cur: Item, nx: Item, wanted: number): number {
  let n = wanted;
  while (n > 1) {
    const fitsNext = nx.seg.t0 - n * nx.seg.bar >= 0;
    const fitsCur = n * cur.seg.bar <= cur.seg.len - cur.seg.bar;
    if (fitsNext && fitsCur) return n;
    n = n / 2;
  }
  return 0;
}

function autoBlendBars(cur: Item, nx: Item, kc: Compat): number {
  const d = Math.abs(nx.seg.bpm / cur.seg.bpm - 1);
  if (kc === "distante") return 2;
  if (d <= 0.03) return 8;
  return 4;
}

function resolve(items: Item[], i: number): { exit: ResolvedExit; fellBack: boolean; blendBars: number } {
  const cur = items[i], nx = items[i + 1];
  if (cur.forced) {
    const bb = cur.forced === "blend" && nx ? fitBlend(cur, nx, cur.track.blendBars || autoBlendBars(cur, nx, keyCompatOf(cur.track, nx.track))) : 0;
    return { exit: cur.forced === "blend" && !bb ? "echo" : cur.forced, fellBack: false, blendBars: bb };
  }
  let x = cur.track.exit;
  if (!nx) {
    const last: ResolvedExit = x === "auto" || x === "blend" || x === "rampa" || x === "riser" || x === "rewind" ? "fade" : x;
    return { exit: last, fellBack: false, blendBars: 0 };
  }
  const r = nx.seg.bpm / cur.seg.bpm;
  const kc = keyCompatOf(cur.track, nx.track);
  if (x === "auto") {
    if (Math.abs(r - 1) <= BLEND_MAX) {
      const bb = fitBlend(cur, nx, cur.track.blendBars || autoBlendBars(cur, nx, kc));
      if (bb) return { exit: "blend", fellBack: false, blendBars: bb };
      x = kc === "distante" ? "rewind" : "echo";
    } else if (r < 1 - BLEND_MAX) x = "vocal";
    else x = "riser";
    return { exit: x, fellBack: false, blendBars: 0 };
  }
  if (x === "blend") {
    if (Math.abs(r - 1) > 0.15) return { exit: "riser", fellBack: true, blendBars: 0 };
    const bb = fitBlend(cur, nx, cur.track.blendBars || autoBlendBars(cur, nx, kc));
    if (!bb) return { exit: "echo", fellBack: true, blendBars: 0 };
    return { exit: "blend", fellBack: false, blendBars: bb };
  }
  if (x === "rampa" && (r < RAMP_MIN || r > RAMP_MAX)) return { exit: "riser", fellBack: true, blendBars: 0 };
  return { exit: x, fellBack: false, blendBars: 0 };
}

function autoFx(exit: ResolvedExit): ElementKind[] {
  return exit === "riser" || exit === "vocal" || exit === "rewind" ? ["impacto"] : [];
}

function timing(exit: ResolvedExit, seg: Segment, ratio: number, trackDur: number): Timing {
  const { len, bar, spb } = seg;
  switch (exit) {
    case "blend": {
      const tail = Math.max(0, Math.min(bar, trackDur - (seg.t0 + len) - 0.05));
      return { end: len + tail, next: len, tail };
    }
    case "vocal": return { end: len, next: len + bar };
    case "echo": return { end: len, next: len + 2 * spb };
    case "rewind": {
      const tr = 0.35 * bar, cut = len - bar / 2;
      return { end: cut + tr, next: cut + tr + 0.04, cut, tr };
    }
    case "rampa": {
      const N = Math.min(4, seg.bars);
      const content = N * bar;
      const T = Math.abs(ratio - 1) < 1e-6 ? content : (content * Math.log(ratio)) / (ratio - 1);
      const rs = len - content;
      return { end: rs + T, next: rs + T, rs, T };
    }
    default: return { end: len, next: len };
  }
}

export function buildPlan(input: PlanItem[]): Plan {
  const items: Item[] = input.map((x) => ({ track: x.track, seg: x.seg ?? segmentOf(x.track), forced: x.exit, forcedFx: x.fx }));
  const entries: PlanEntry[] = [];
  let T = 0;
  let pendingPreroll: { bars: number; tempo: number } | null = null;
  items.forEach((it, i) => {
    const { exit, fellBack, blendBars } = resolve(items, i);
    const nx = items[i + 1];
    const ratio = nx ? Math.min(RAMP_MAX, Math.max(RAMP_MIN, nx.seg.bpm / it.seg.bpm)) : 1;
    const tm = timing(exit, it.seg, ratio, it.track.duration);
    const fxAuto = !it.forcedFx && it.track.fx === null;
    const fx = it.forcedFx ?? it.track.fx ?? autoFx(exit);
    const preroll: Preroll | null = pendingPreroll
      ? { bars: pendingPreroll.bars, tempo: pendingPreroll.tempo, start: T - pendingPreroll.bars * entries[i - 1].seg.bar }
      : null;
    entries.push({
      track: it.track, seg: it.seg, exit, ratio, fx: nx ? fx : [], fxAuto, preroll, T,
      end: T + tm.end, next: T + tm.next, tm,
      gain: Math.min(6, Math.max(0.2, 0.16 / Math.max(1e-4, segmentRms(it.track.buffer, it.seg)))),
      keyCompat: nx ? keyCompatOf(it.track, nx.track) : null,
      fellBack
    });
    pendingPreroll = exit === "blend" && nx ? { bars: blendBars, tempo: it.seg.bpm / nx.seg.bpm } : null;
    T += tm.next;
  });
  const last = entries[entries.length - 1];
  return { entries, total: (last ? Math.max(last.end, last.next) : 0) + 3 };
}

/** Tempos das partes detectadas, para mostrar na forma de onda. */
export function sectionTimes(t: Track): number[] {
  const st = structureOf(t);
  return st.boundaries.map((b) => st.times[b]).filter((x) => x !== undefined);
}
