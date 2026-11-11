import { Plan } from "./plan";
import { EXIT_LABEL } from "./types";

export function formatTime(t: number): string {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

export function wavBlob(buf: AudioBuffer): Blob {
  const n = buf.length, ch = 2, bytes = 44 + n * ch * 2;
  const out = new ArrayBuffer(bytes), v = new DataView(out);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, bytes - 8, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * ch * 2, true);
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    o += 4;
  }
  return new Blob([out], { type: "audio/wav" });
}

export function mp3Blob(buf: AudioBuffer, onProgress?: (p: number) => void, kbps = 256): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
    const left = buf.getChannelData(0).slice();
    const right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
    worker.onmessage = (e) => {
      if (e.data.progress !== undefined) onProgress?.(e.data.progress);
      else if (e.data.blob) { resolve(e.data.blob); worker.terminate(); }
      else { reject(new Error(e.data.error)); worker.terminate(); }
    };
    worker.onerror = (e) => { reject(new Error(e.message)); worker.terminate(); };
    worker.postMessage({ left, right, sampleRate: buf.sampleRate, kbps }, [left.buffer, right.buffer]);
  });
}

/** Marcadores em texto: um por música, com tempo, BPM e saída. */
export function markersText(plan: Plan): string {
  const lines = plan.entries.map((e, i) => {
    const last = i === plan.entries.length - 1;
    return `${formatTime(e.T)}\t${i + 1}. ${e.track.name}\t${e.seg.bpm.toFixed(1)} BPM${last ? "" : `\tsai com: ${EXIT_LABEL[e.exit]}`}`;
  });
  return `Marcadores do mix (minutos:segundos)\r\n\r\n${lines.join("\r\n")}\r\n`;
}

/** CSV de marcadores no formato que editores de vídeo costumam importar (nome, início em segundos). */
export function markersCsv(plan: Plan): string {
  const rows = plan.entries.map((e, i) => `"${(i + 1) + ". " + e.track.name.replace(/"/g, "'")}",${e.T.toFixed(3)},${e.seg.bpm.toFixed(2)}`);
  return `nome,inicio_segundos,bpm\n${rows.join("\n")}\n`;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
