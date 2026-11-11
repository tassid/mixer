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
    const msg = {
      id,
      bpm: rhythm.bpm,
      confidence: rhythm.confidence,
      beats,
      key: key.key,
      scale: key.scale === "minor" ? "minor" : "major",
      keyStrength: key.strength,
      ...feats
    };
    (self as unknown as Worker).postMessage(msg, [beats.buffer, feats.lowOnset.buffer, feats.energyCum.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
