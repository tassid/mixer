import { camelot, compat, Compat } from "./keys";
import { segmentOf, segmentRms } from "./analyze";
import { structureOf } from "./structure";
import { stretchedDuration } from "./stretch";
import type { ElementKind, ResolvedExit, Segment, Track } from "./types";

/*
 * Regras de DJ usadas aqui:
 * 1. Frases: cada música entra no tempo 1 de uma parte e sai no fim da parte.
 * 2. Ponte de andamento (key lock): a música que sai acelera ou desacelera até o BPM do meio
 *    do caminho; a que entra começa nesse BPM e vai até o dela. Ninguém muda de tom.
 * 3. Mixagem DJ: com BPMs próximos, a próxima entra por baixo, sem graves, e os graves trocam no tempo 1.
 * 4. BPMs muito diferentes: corte com efeito (riser, suspende, rewind) no fim da frase.
 */

export interface Preroll { bars: number; start: number; rate: number }
export interface Bridge { bars: number; rate: number } // compassos de rampa e velocidade no extremo (1 = original)

export interface PlanEntry {
  track: Track;
  seg: Segment;
  exit: ResolvedExit;
  fx: ElementKind[];
  fxAuto: boolean;
  /** esta música entra por baixo da anterior (mixagem DJ) */
  preroll: Preroll | null;
  /** começo: rampa da velocidade `rate` até 1 */
  inBridge: Bridge | null;
  /** final: rampa de 1 até `rate`, depois `overlapBars` compassos nessa velocidade */
  outBridge: Bridge | null;
  overlapBars: number;
  T: number;
  /** quando começa a parte em velocidade original, quando começa a rampa de saída */
  midStart: number;
  tailStart: number;
  /** tempo 1 da próxima */
  swap: number;
  end: number;
  next: number;
  /** compasso e tempo no fim desta música, já na velocidade da rampa */
  barOut: number;
  beatOut: number;
  /** quanto conteúdo depois do trecho toca saindo (mixagem DJ) */
  tailContent: number;
  gain: number;
  keyCompat: Compat | null;
  fellBack: boolean;
}

export interface Plan { entries: PlanEntry[]; total: number }
export interface PlanItem { track: Track; seg?: Segment; exit?: ResolvedExit; fx?: ElementKind[] }

const BLEND_MAX = 0.08;
const RATE_MIN = 0.85, RATE_MAX = 1.18;

type Item = { track: Track; seg: Segment; forced?: ResolvedExit; forcedFx?: ElementKind[] };

const clampRate = (r: number) => Math.min(RATE_MAX, Math.max(RATE_MIN, r));

function keyCompatOf(a: Track, b: Track): Compat {
  return compat(camelot(a.analysis.key, a.analysis.scale), camelot(b.analysis.key, b.analysis.scale));
}

function autoBlendBars(cur: Item, nx: Item, kc: Compat): number {
  const d = Math.abs(nx.seg.bpm / cur.seg.bpm - 1);
  if (kc === "distante") return 2;
  if (d <= 0.03) return 8;
  return 4;
}

function chooseExit(items: Item[], i: number): { exit: ResolvedExit; fellBack: boolean; wantBlend: number } {
  const cur = items[i], nx = items[i + 1];
  if (!nx) {
    const x = cur.forced ?? cur.track.exit;
    const last: ResolvedExit = ["auto", "blend", "rampa", "riser", "rewind"].includes(x) ? "fade" : (x as ResolvedExit);
    return { exit: last, fellBack: false, wantBlend: 0 };
  }
  const r = nx.seg.bpm / cur.seg.bpm;
  const kc = keyCompatOf(cur.track, nx.track);
  const x = cur.forced ?? cur.track.exit;
  const want = cur.track.blendBars || autoBlendBars(cur, nx, kc);
  if (x === "auto") {
    if (Math.abs(r - 1) <= BLEND_MAX) return { exit: "blend", fellBack: false, wantBlend: want };
    return { exit: r < 1 ? "vocal" : "riser", fellBack: false, wantBlend: 0 };
  }
  if (x === "blend" && Math.abs(r - 1) > 0.15) return { exit: "riser", fellBack: true, wantBlend: 0 };
  return { exit: x, fellBack: false, wantBlend: x === "blend" ? want : 0 };
}

/** Elementos automáticos, variando entre transições para não repetir sempre o mesmo. */
function autoFx(exit: ResolvedExit, i: number, overlap: number): ElementKind[] {
  const alt = i % 2 === 1;
  switch (exit) {
    case "blend": return overlap >= 4 ? (alt ? ["whoosh", "flash"] : ["revcymbal", "shutter"]) : (alt ? ["whoosh"] : ["shutter"]);
    case "riser": return alt ? ["flash", "impacto"] : ["impacto", "shutter"];
    case "vocal": return alt ? ["subdrop", "shutter"] : ["flash", "subdrop"];
    case "echo": return alt ? ["revcymbal"] : ["whoosh"];
    case "rewind": return ["impacto"];
    case "corte": return alt ? ["flash", "impacto"] : ["shutter", "impacto"];
    case "rampa": return ["whoosh", "impacto"];
    default: return [];
  }
}

export function buildPlan(input: PlanItem[]): Plan {
  const items: Item[] = input.map((x) => ({ track: x.track, seg: x.seg ?? segmentOf(x.track), forced: x.exit, forcedFx: x.fx }));
  const n = items.length;

  // 1) estilo de cada transição
  const choice = items.map((_, i) => chooseExit(items, i));

  // 2) pontes de andamento e sobreposições, cabendo nos trechos
  const outB: (Bridge | null)[] = new Array(n).fill(null);
  const inB: (Bridge | null)[] = new Array(n).fill(null);
  const overlap = new Array(n).fill(0);
  const fellBack = choice.map((c) => c.fellBack);
  const exits = choice.map((c) => c.exit);
  for (let i = 0; i < n - 1; i++) {
    const A = items[i], B = items[i + 1];
    const a = A.seg.bpm, b = B.seg.bpm, mid = Math.sqrt(a * b);
    const rA = clampRate(mid / a), rB = clampRate(mid / b);
    const needs = Math.abs(Math.log(b / a)) > 0.015;
    let K = needs ? (exits[i] === "rampa" ? 8 : 4) : 0;
    let N = exits[i] === "blend" ? choice[i].wantBlend : 0;
    const usedA = () => (inB[i]?.bars ?? 0) + K + N;
    while (K > 0 || N > 0) {
      const fitsA = usedA() <= A.seg.bars - 1;
      const fitsB = K <= B.seg.bars - 2 && B.seg.t0 - N * B.seg.bar >= 0;
      if (fitsA && fitsB) break;
      if (N > 2) N /= 2;
      else if (K > 2) K /= 2;
      else if (N > 0) N = 0;
      else K = 0;
    }
    if (exits[i] === "blend" && N === 0) { exits[i] = "echo"; fellBack[i] = true; }
    overlap[i] = N;
    if (K > 0) { outB[i] = { bars: K, rate: rA }; inB[i + 1] = { bars: K, rate: rB }; }
    else if (N > 0) {
      // BPMs quase iguais: sem rampa, a próxima só entra no BPM desta
      outB[i] = { bars: 0, rate: 1 }; inB[i + 1] = { bars: 0, rate: a / b };
    }
  }

  // 3) linha do tempo
  const entries: PlanEntry[] = [];
  let T = 0;
  items.forEach((it, i) => {
    const { seg, track } = it;
    const nx = items[i + 1];
    const ib = inB[i], ob = outB[i];
    const exit = exits[i];
    const N = overlap[i];
    const Kin = ib?.bars ?? 0, Kout = ob?.bars ?? 0;
    const rOut = ob?.rate ?? 1;
    const head = Kin ? stretchedDuration(Kin * seg.bar, ib!.rate, 1) : 0;
    const midContent = seg.len - (Kin + Kout + N) * seg.bar;
    const tailRamp = Kout ? stretchedDuration(Kout * seg.bar, 1, rOut) : 0;
    const ov = N ? stretchedDuration(N * seg.bar, rOut, rOut) : 0;
    const midStart = T + head;
    const tailStart = midStart + midContent;
    const segEnd = tailStart + tailRamp + ov;
    const barOut = seg.bar / rOut, beatOut = seg.spb / rOut;
    let swap = segEnd, end = segEnd, tailContent = 0;
    switch (exit) {
      case "blend":
        tailContent = Math.max(0, Math.min(seg.bar, track.duration - (seg.t0 + seg.len) - 0.05));
        end = segEnd + stretchedDuration(tailContent, rOut, rOut);
        break;
      case "vocal": swap = segEnd + barOut; break;
      case "echo": swap = segEnd + 2 * beatOut; break;
      case "rewind": {
        const tr = 0.35 * barOut;
        end = segEnd - barOut / 2 + tr;
        swap = end + 0.04;
        break;
      }
      default: break;
    }
    const fxAuto = !it.forcedFx && track.fx === null;
    const fx = nx ? (it.forcedFx ?? track.fx ?? autoFx(exit, i, N)) : [];
    const prev = entries[i - 1];
    const preroll: Preroll | null = prev && prev.overlapBars > 0 && ib
      ? { bars: prev.overlapBars, start: T - stretchedDuration(prev.overlapBars * seg.bar, ib.rate, ib.rate), rate: ib.rate }
      : null;
    entries.push({
      track, seg, exit, fx, fxAuto, preroll, inBridge: ib, outBridge: ob, overlapBars: N,
      T, midStart, tailStart, swap, end, next: swap, barOut, beatOut, tailContent,
      gain: Math.min(6, Math.max(0.2, 0.16 / Math.max(1e-4, segmentRms(track.buffer, seg)))),
      keyCompat: nx ? keyCompatOf(track, nx.track) : null,
      fellBack: fellBack[i]
    });
    T = swap;
  });
  const last = entries[entries.length - 1];
  return { entries, total: (last ? Math.max(last.end, last.next) : 0) + 3 };
}

/** Tempos das partes detectadas, para mostrar na forma de onda. */
export function sectionTimes(t: Track): number[] {
  const st = structureOf(t);
  return st.boundaries.map((b) => st.times[b]).filter((x) => x !== undefined);
}
