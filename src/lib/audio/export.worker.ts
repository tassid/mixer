/// <reference lib="webworker" />
import { Mp3Encoder } from "@breezystack/lamejs";

self.onmessage = (ev: MessageEvent<{ left: Float32Array; right: Float32Array; sampleRate: number; kbps: number }>) => {
  const { left, right, sampleRate, kbps } = ev.data;
  try {
    const enc = new Mp3Encoder(2, sampleRate, kbps);
    const block = 1152;
    const parts: Uint8Array[] = [];
    const l16 = new Int16Array(block), r16 = new Int16Array(block);
    for (let i = 0; i < left.length; i += block) {
      const n = Math.min(block, left.length - i);
      for (let k = 0; k < n; k++) {
        l16[k] = Math.max(-1, Math.min(1, left[i + k])) * 32767;
        r16[k] = Math.max(-1, Math.min(1, right[i + k])) * 32767;
      }
      const buf = enc.encodeBuffer(l16.subarray(0, n), r16.subarray(0, n));
      if (buf.length) parts.push(new Uint8Array(buf));
      if (i % (block * 400) === 0) (self as unknown as Worker).postMessage({ progress: i / left.length });
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    const blob = new Blob(parts as BlobPart[], { type: "audio/mpeg" });
    (self as unknown as Worker).postMessage({ blob });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String(err) });
  }
};
