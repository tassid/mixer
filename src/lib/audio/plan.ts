import { camelot, compat, Compat } from "./keys";
import { segmentOf, segmentRms } from "./analyze";
import { ResolvedExit, Segment, Track } from "./types";

export interface PlanEntry {
  track: Track;
  seg: Segment;
  exit: ResolvedExit;
  /** razão de andamento para a rampa (BPM da próxima / BPM desta) */
  ratio: number;
  impact: boolean;
  /** início desta música no mix */
  T: number;
  /** quando o áudio desta música termina */
  end: number;
  /** quando a próxima começa */
  next: number;
  tm: Timing;
  gain: number;
  keyCompat: Compat | null;
  /** a saída pedida não coube e foi trocada */
  fellBack: boolean;
}

export interface Timing { end: number; next: number; cut?: number; tr?: number; rs?: number; T?: number }

export interface Plan { entries: PlanEntry[]; total: number }

export interface PlanItem { track: Track; seg?: Segment; exit?: ResolvedExit; impact?: boolean }

const RAMP_MIN = 0.9, RAMP_MAX = 1.12;

function resolveExit(items: { track: Track; seg: Segment }[], i: number, forced?: ResolvedExit): { exit: ResolvedExit; fellBack: boolean } {
  if (forced) return { exit: forced, fellBack: false };
  const cur = items[i], nx = items[i + 1];
  let x = cur.track.exit;
  if (x === "auto") {
    if (!nx) return { exit: "fade", fellBack: false };
    const r = nx.seg.bpm / cur.seg.bpm;
    const kc = compat(camelot(cur.track.analysis.key, cur.track.analysis.scale), camelot(nx.track.analysis.key, nx.track.analysis.scale));
    if (r < 0.95) x = "vocal";
    else if (r >= 1.02 && r <= 1.09) x = "rampa";
    else if (r > 1.09) x = "riser";
    else x = kc === "distante" ? "rewind" : "echo";
    return { exit: x, fellBack: false };
  }
  if (x === "rampa") {
    const r = nx ? nx.seg.bpm / cur.seg.bpm : 1;
    if (!nx || r < RAMP_MIN || r > RAMP_MAX) return { exit: "riser", fellBack: true };
  }
  return { exit: x, fellBack: false };
}

function timing(exit: ResolvedExit, seg: Segment, ratio: number): Timing {
  const { len, bar, spb } = seg;
  switch (exit) {
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
  const items = input.map((x) => ({ track: x.track, seg: x.seg ?? segmentOf(x.track), forced: x.exit, forcedImpact: x.impact }));
  const entries: PlanEntry[] = [];
  let T = 0;
  items.forEach((it, i) => {
    const { exit, fellBack } = resolveExit(items, i, it.forced);
    const nx = items[i + 1];
    const ratio = nx ? Math.min(RAMP_MAX, Math.max(RAMP_MIN, nx.seg.bpm / it.seg.bpm)) : 1;
    const prev = entries[i - 1];
    let impact = false;
    if (it.forcedImpact !== undefined) impact = it.forcedImpact;
    else if (i > 0) {
      impact = it.track.impact === "sim" ? true : it.track.impact === "nao" ? false : ["riser", "vocal", "rewind"].includes(prev.exit);
    }
    const tm = timing(exit, it.seg, ratio);
    const rms = segmentRms(it.track.buffer, it.seg);
    const keyCompat = nx
      ? compat(camelot(it.track.analysis.key, it.track.analysis.scale), camelot(nx.track.analysis.key, nx.track.analysis.scale))
      : null;
    entries.push({
      track: it.track, seg: it.seg, exit, ratio, impact, T, end: T + tm.end, next: T + tm.next, tm,
      gain: Math.min(6, Math.max(0.2, 0.16 / Math.max(1e-4, rms))), keyCompat, fellBack
    });
    T += tm.next;
  });
  return { entries, total: T + 3 };
}
