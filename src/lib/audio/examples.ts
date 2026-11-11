import { SR } from "./types";

/** Gera uma batida de exemplo (bumbo forte no tempo 1, caixa no 2 e 4, baixo e acordes no meio). */
export function synthTrack(bpm: number, root: number, bars: number, hats16: boolean): AudioBuffer {
  const spb = 60 / bpm;
  const len = Math.ceil((bars * 4 * spb + 1.5) * SR);
  const b = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SR });
  const L = b.getChannelData(0), R = b.getChannelData(1);
  let seed = Math.round(bpm * 97);
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };
  const add = (t: number, dur: number, fn: (t: number) => number, pan = 0) => {
    const s = Math.floor(t * SR), n = Math.floor(dur * SR);
    for (let i = 0; i < n && s + i < len; i++) { const v = fn(i / SR); L[s + i] += v * (1 - pan); R[s + i] += v * (1 + pan); }
  };
  const kick = (g: number) => (t: number) => Math.sin(2 * Math.PI * (45 * t + (80 / 18) * (1 - Math.exp(-18 * t)))) * Math.exp(-7 * t) * g;
  const snare = (t: number) => (rnd() * 0.55 + Math.sin(2 * Math.PI * 190 * t) * 0.3) * Math.exp(-20 * t) * 0.55;
  const hat = (g: number) => (t: number) => rnd() * Math.exp(-90 * t) * g;
  const prog = [0, -4, 3, -2];
  for (let bar = 0; bar < bars; bar++) {
    const strong = bar >= 8 && bar < 24, tb = bar * 4 * spb;
    const f = root * Math.pow(2, prog[bar % 4] / 12);
    add(tb, 4 * spb, (t) => Math.sin(2 * Math.PI * f * t) * Math.min(1, t * 200) * Math.exp(-0.9 * t) * 0.32);
    if (strong) for (const iv of [0, 3, 7]) add(tb, 4 * spb, (t) => Math.sin(2 * Math.PI * f * 4 * Math.pow(2, iv / 12) * t) * 0.05 * Math.min(1, t * 6) * Math.exp(-0.5 * t), iv ? 0.3 : -0.3);
    for (let beat = 0; beat < 4; beat++) {
      const t = tb + beat * spb;
      if (beat === 0) add(t, 0.6, kick(0.95));
      if (beat === 2) add(t, 0.6, kick(0.6));
      if (strong && beat === 2) add(t + spb / 2, 0.5, kick(0.45));
      if (beat === 1 || beat === 3) add(t, 0.4, snare);
      const div = strong && hats16 ? 4 : 2;
      for (let h = 0; h < div; h++) add(t + (h * spb) / div, 0.08, hat(strong ? 0.17 : 0.11), 0.2);
    }
  }
  return b;
}

export const EXAMPLES: { name: string; bpm: number; root: number; hats16: boolean }[] = [
  { name: "Exemplo A: trap lento", bpm: 73, root: 55, hats16: true },
  { name: "Exemplo B: boom bap", bpm: 82, root: 61.7, hats16: false },
  { name: "Exemplo C: hip hop cheio", bpm: 93, root: 49, hats16: true }
];
