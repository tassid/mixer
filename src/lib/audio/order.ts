/* Ordem automática: BPM próximo, tons compatíveis e energia subindo aos poucos. */
import { camelot, compat } from "./keys";
import { segmentOf } from "./analyze";
import { structureOf } from "./structure";
import type { Track } from "./types";

function energyOf(t: Track): number {
  const st = structureOf(t);
  const seg = segmentOf(t);
  const j = t.startDown;
  const n = Math.max(1, Math.min(seg.bars, st.energy.length - j));
  let e = 0;
  for (let k = j; k < j + n; k++) e += st.energy[k] ?? 0;
  return e / n;
}

export function transitionCost(a: Track, b: Track): number {
  const sa = segmentOf(a), sb = segmentOf(b);
  const tempo = Math.abs(Math.log2(sb.bpm / sa.bpm)) * 12; // 6% de diferença custa ~1
  const kc = compat(camelot(a.analysis.key, a.analysis.scale), camelot(b.analysis.key, b.analysis.scale));
  const key = kc === "mesmo" ? 0 : kc === "vizinho" ? 0.25 : 1;
  return tempo + key;
}

/** Retorna os ids na melhor ordem encontrada. Busca completa até 8 músicas, gulosa acima disso. */
export function smartOrder(tracks: Track[]): string[] {
  const n = tracks.length;
  if (n < 3) return tracks.map((t) => t.id);
  const cost = tracks.map((a) => tracks.map((b) => (a === b ? 0 : transitionCost(a, b))));
  const energy = tracks.map(energyOf);
  const arcPenalty = (order: number[]) => {
    // energia deve subir; quedas custam, e o final deve estar entre os mais fortes
    let p = 0;
    for (let i = 1; i < order.length; i++) p += Math.max(0, energy[order[i - 1]] - energy[order[i]]) * 0.6;
    const maxE = Math.max(...energy);
    p += (maxE - energy[order[order.length - 1]]) * 0.4;
    return p;
  };
  const total = (order: number[]) => {
    let c = 0;
    for (let i = 1; i < order.length; i++) c += cost[order[i - 1]][order[i]];
    return c + arcPenalty(order);
  };

  let best: number[] = tracks.map((_, i) => i);
  let bestCost = total(best);
  if (n <= 8) {
    const used = new Array(n).fill(false), cur: number[] = [];
    const rec = (acc: number) => {
      if (acc >= bestCost) return;
      if (cur.length === n) {
        const c = total(cur);
        if (c < bestCost) { bestCost = c; best = [...cur]; }
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true; cur.push(i);
        rec(acc + (cur.length > 1 ? cost[cur[cur.length - 2]][i] : 0));
        cur.pop(); used[i] = false;
      }
    };
    rec(0);
  } else {
    for (let s = 0; s < n; s++) {
      const used = new Array(n).fill(false), order = [s];
      used[s] = true;
      while (order.length < n) {
        const last = order[order.length - 1];
        let bi = -1, bc = Infinity;
        for (let i = 0; i < n; i++) if (!used[i] && cost[last][i] < bc) { bc = cost[last][i]; bi = i; }
        used[bi] = true; order.push(bi);
      }
      const c = total(order);
      if (c < bestCost) { bestCost = c; best = order; }
    }
  }
  return best.map((i) => tracks[i].id);
}
