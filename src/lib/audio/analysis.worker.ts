/// <reference lib="webworker" />
/*
 * Análise pesada fora da thread principal.
 * BPM, batidas e tom vêm do essentia.js (RhythmExtractor2013 e KeyExtractor).
 * Energia grave e energia total são calculadas aqui para achar o tempo 1 e o trecho mais forte.
 */
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import Essentia from "essentia.js/dist/essentia.js-core.es.js";

const HOP = 512;
let essentia: Essentia | null = null;

function ready(): Promise<void> {
  return new Promise((resolve) => {
    if (EssentiaWASM.calledRun) resolve();
    else EssentiaWASM.onRuntimeInitialized = () => resolve();
  });
}

function energyFeatures(x: Float32Array, sampleRate: number) {
  const n = Math.floor(x.length / HOP);
  const E = new Float32Array(n);
  const LE = new Float32Array(n);
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  let lp = 0;
  for (let f = 0; f < n; f++) {
    let e = 0, le = 0;
    const s0 = f * HOP;
    for (let i = s0; i < s0 + HOP; i++) {
      const v = x[i];
      e += v * v;
      lp = a * lp + (1 - a) * v;
      le += lp * lp;
    }
    E[f] = e / HOP;
    LE[f] = le / HOP;
  }
  const lowOnset = new Float32Array(n);
  let prev = Math.log(1 + 1000 * LE[0]);
  for (let i = 1; i < n; i++) {
    const v = Math.log(1 + 1000 * LE[i]);
    lowOnset[i] = Math.max(0, v - prev);
    prev = v;
  }
  const energyCum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) energyCum[i + 1] = energyCum[i] + E[i];
  return { lowOnset, energyCum, fps: sampleRate / HOP };
}

/* ---------- espectro: timbre (mel) e harmonia (croma) por frame ---------- */
const N_FFT = 2048, SPEC_HOP = 1024, N_MEL = 24;

function fftMag(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

function spectralFeatures(x: Float32Array, sampleRate: number) {
  // reduz para metade da taxa (suficiente para timbre e harmonia)
  const sr = sampleRate / 2;
  const y = new Float32Array(Math.floor(x.length / 2));
  for (let i = 0; i < y.length; i++) y[i] = (x[2 * i] + x[2 * i + 1]) * 0.5;
  const frames = Math.max(0, Math.floor((y.length - N_FFT) / SPEC_HOP) + 1);
  const win = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1));
  const bins = N_FFT / 2;
  // filtros mel
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const imel = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);
  const mLo = mel(40), mHi = mel(8000);
  const edges = Array.from({ length: N_MEL + 2 }, (_, i) => imel(mLo + ((mHi - mLo) * i) / (N_MEL + 1)));
  const binHz = sr / N_FFT;
  // classe de altura por bin (60 Hz a 4 kHz)
  const pc = new Int8Array(bins).fill(-1);
  for (let b = 1; b < bins; b++) {
    const f = b * binHz;
    if (f >= 60 && f <= 4000) pc[b] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const melOut = new Float32Array(frames * N_MEL);
  const chromaOut = new Float32Array(frames * 12);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), mag = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const s0 = f * SPEC_HOP;
    for (let i = 0; i < N_FFT; i++) { re[i] = y[s0 + i] * win[i]; im[i] = 0; }
    fftMag(re, im);
    for (let b = 0; b < bins; b++) mag[b] = re[b] * re[b] + im[b] * im[b];
    for (let m = 0; m < N_MEL; m++) {
      const lo = edges[m], c = edges[m + 1], hi = edges[m + 2];
      let e = 0;
      for (let b = Math.floor(lo / binHz); b <= Math.ceil(hi / binHz) && b < bins; b++) {
        const fr = b * binHz;
        const w = fr < c ? (fr - lo) / (c - lo) : (hi - fr) / (hi - c);
        if (w > 0) e += w * mag[b];
      }
      melOut[f * N_MEL + m] = Math.log(1 + 100 * e);
    }
    let tot = 0;
    for (let b = 1; b < bins; b++) if (pc[b] >= 0) { const v = Math.sqrt(mag[b]); chromaOut[f * 12 + pc[b]] += v; tot += v; }
    if (tot > 0) for (let k = 0; k < 12; k++) chromaOut[f * 12 + k] /= tot;
  }
  return { mel: melOut, chroma: chromaOut, specFps: sr / SPEC_HOP, nMel: N_MEL };
}

self.onmessage = async (ev: MessageEvent<{ id: number; mono: Float32Array; sampleRate: number }>) => {
  const { id, mono, sampleRate } = ev.data;
  try {
    await ready();
    if (!essentia) essentia = new Essentia(EssentiaWASM);
    const vec = essentia.arrayToVector(mono);
    const rhythm = essentia.RhythmExtractor2013(vec, 208, "multifeature", 40);
    const beats = new Float32Array(essentia.vectorToArray(rhythm.ticks));
    const key = essentia.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, "bgate", sampleRate, 0.0001, 440, "cosine", "hann");
    vec.delete?.();
    rhythm.ticks.delete?.();
    rhythm.estimates?.delete?.();
    rhythm.bpmIntervals?.delete?.();
    const feats = energyFeatures(mono, sampleRate);
    const spec = spectralFeatures(mono, sampleRate);
    const msg = {
      id,
      bpm: rhythm.bpm,
      confidence: rhythm.confidence,
      beats,
      key: key.key,
      scale: key.scale === "minor" ? "minor" : "major",
      keyStrength: key.strength,
      ...feats,
      ...spec
    };
    (self as unknown as Worker).postMessage(msg, [beats.buffer, feats.lowOnset.buffer, feats.energyCum.buffer, spec.mel.buffer, spec.chroma.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
