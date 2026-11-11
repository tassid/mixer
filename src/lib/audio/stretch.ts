import { SimpleFilter, SoundTouch } from "soundtouchjs";

/**
 * Muda o andamento de um trecho aos poucos (de r0 até r1) sem mudar o tom, usando SoundTouch.
 * O tamanho de saída é exato: n * ln(r1/r0) / (r1 - r0).
 */
export function stretchRamp(buffer: AudioBuffer, from: number, dur: number, r0: number, r1: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const n = Math.max(1, Math.min(buffer.length - a, Math.floor(dur * sr)));
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
  const st = new SoundTouch();
  st.tempo = r0;
  const filter = new SimpleFilter(source, st);
  const total = Math.round(Math.abs(r1 - r0) < 1e-6 ? n / r0 : (n * Math.log(r1 / r0)) / (r1 - r0));
  const out = new AudioBuffer({ length: total, numberOfChannels: 2, sampleRate: sr });
  const oL = out.getChannelData(0), oR = out.getChannelData(1);
  const chunk = new Float32Array(4096 * 2);
  let o = 0;
  while (o < total) {
    const prog = Math.min(1, filter.sourcePosition / n);
    st.tempo = r0 + (r1 - r0) * prog;
    const got = filter.extract(chunk, 4096);
    if (got === 0) break;
    for (let i = 0; i < got && o < total; i++, o++) { oL[o] = chunk[2 * i]; oR[o] = chunk[2 * i + 1]; }
  }
  return out;
}
