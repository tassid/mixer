declare module "essentia.js/dist/essentia-wasm.es.js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const EssentiaWASM: any;
}

declare module "essentia.js/dist/essentia.js-core.es.js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Vector = any;
  export default class Essentia {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(wasm: any);
    arrayToVector(a: Float32Array): Vector;
    vectorToArray(v: Vector): Float32Array;
    RhythmExtractor2013(
      signal: Vector,
      maxTempo?: number,
      method?: string,
      minTempo?: number
    ): { bpm: number; confidence: number; ticks: Vector; estimates: Vector; bpmIntervals: Vector };
    KeyExtractor(
      audio: Vector,
      averageDetuningCorrection?: boolean,
      frameSize?: number,
      hopSize?: number,
      hpcpSize?: number,
      maxFrequency?: number,
      maximumSpectralPeaks?: number,
      minFrequency?: number,
      pcpThreshold?: number,
      profileType?: string,
      sampleRate?: number,
      spectralPeaksThreshold?: number,
      tuningFrequency?: number,
      weightType?: string,
      windowType?: string
    ): { key: string; scale: string; strength: number };
  }
}
