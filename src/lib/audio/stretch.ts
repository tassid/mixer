import { SimpleFilter, SoundTouch } from "soundtouchjs";

/** Um pedaço de conteúdo tocado com a velocidade indo de r0 até r1 (1 = original), sem mudar o tom. */
export interface StretchPiece { content: number; r0: number; r1: number }

/** Duração no mix de um conteúdo cuja velocidade varia linearmente (pela posição no conteúdo) de r0 até r1. */
export function stretchedDuration(content: number, r0: number, r1: number): number {
  if (content <= 0) return 0;
  return Math.abs(r1 - r0) < 1e-6 ? content / r0 : (content * Math.log(r1 / r0)) / (r1 - r0);
}

/**
 * Muda o andamento de um trecho com SoundTouch (key lock), em pedaços seguidos.
 * Ex.: [{content: 4 compassos, r0: 1, r1: 1.05}, {content: 8 compassos, r0: 1.05, r1: 1.05}]
 * O tamanho de saída é exato, igual à soma de stretchedDuration.
 */
export function stretchPieces(buffer: AudioBuffer, from: number, pieces: StretchPiece[]): AudioBuffer {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const totalContent = pieces.reduce((s, p) => s + p.content, 0);
  const n = Math.max(1, Math.min(buffer.length - a, Math.floor(totalContent * sr)));
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const pad = n + 32768;
  const source = {
    extract(target: Float32Array, num: number, pos: number) {
      let c = 0;
      for (let i = 0; i < num && pos + i < pad; i++) {
        const p = pos + i;
        target[2 * i] = p < n ? L[a + p] : 0;
        target[2 * i + 1] = p < n ? R[a + p] : 0;
        c++;
      }
      return c;
    }
  };
  // velocidade em função da posição no conteúdo
  const bounds: { start: number; end: number; r0: number; r1: number }[] = [];
  let acc = 0;
  for (const p of pieces) { bounds.push({ start: acc, end: acc + p.content * sr, r0: p.r0, r1: p.r1 }); acc += p.content * sr; }
  const rateAt = (pos: number) => {
    for (const b of bounds) if (pos < b.end) return b.r0 + ((b.r1 - b.r0) * (pos - b.start)) / Math.max(1, b.end - b.start);
    const last = bounds[bounds.length - 1];
    return last ? last.r1 : 1;
  };
  const total = Math.max(1, Math.round(pieces.reduce((s, p) => s + stretchedDuration(p.content, p.r0, p.r1), 0) * sr));

  const st = new SoundTouch();
  st.tempo = rateAt(0);
  const filter = new SimpleFilter(source, st);
  const out = new AudioBuffer({ length: total, numberOfChannels: 2, sampleRate: sr });
  const oL = out.getChannelData(0), oR = out.getChannelData(1);
  const chunk = new Float32Array(2048 * 2);
  let o = 0;
  while (o < total) {
    st.tempo = rateAt(filter.sourcePosition);
    const got = filter.extract(chunk, 2048);
    if (got === 0) break;
    for (let i = 0; i < got && o < total; i++, o++) { oL[o] = chunk[2 * i]; oR[o] = chunk[2 * i + 1]; }
  }
  // bordas suaves para emendar sem estalo
  const f = Math.min(Math.floor(0.004 * sr), Math.floor(total / 4));
  for (let i = 0; i < f; i++) {
    const g = i / f;
    oL[i] *= g; oR[i] *= g;
    oL[total - 1 - i] *= g; oR[total - 1 - i] *= g;
  }
  return out;
}

/** Compatibilidade com o código antigo: rampa simples de r0 até r1. */
export function stretchRamp(buffer: AudioBuffer, from: number, dur: number, r0: number, r1: number): AudioBuffer {
  return stretchPieces(buffer, from, [{ content: dur, r0, r1 }]);
}
