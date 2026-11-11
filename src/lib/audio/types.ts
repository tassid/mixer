export const SR = 44100;

export type ExitKind = "auto" | "blend" | "corte" | "vocal" | "riser" | "echo" | "rewind" | "rampa" | "fade";
export type ResolvedExit = Exclude<ExitKind, "auto">;
export type ElementKind = "shutter" | "flash" | "whoosh" | "riser" | "revcymbal" | "impacto" | "subdrop" | "glitch" | "vinylstop";
export type BeatMul = 0.5 | 1 | 2;

/** Resultado bruto da análise (worker + pós-processamento). */
export interface Analysis {
  bpm: number;
  confidence: number;
  beats: Float32Array; // tempos de batida em segundos (essentia RhythmExtractor2013)
  key: string; // ex.: "Eb"
  scale: "major" | "minor";
  keyStrength: number;
  lowOnset: Float32Array; // fluxo de energia grave por frame
  energyCum: Float64Array; // energia acumulada por frame
  fps: number;
  mel: Float32Array; // timbre: nMel bandas por frame espectral
  chroma: Float32Array; // harmonia: 12 classes de altura por frame espectral
  specFps: number;
  nMel: number;
}

export interface Track {
  id: string;
  name: string;
  buffer: AudioBuffer;
  mediaUrl: string; // object URL para o player da forma de onda
  peaks: Float32Array;
  duration: number;
  example: boolean;
  analysis: Analysis;
  beatMul: BeatMul;
  mulByUser: boolean;
  phase: number; // índice da batida que é o tempo 1 (0 a 3)
  bars: number;
  startDown: number; // índice do tempo 1 onde o trecho começa
  userStart: boolean;
  exit: ExitKind;
  /** elementos na transição que sai desta música; null = automático */
  fx: ElementKind[] | null;
  /** compassos de sobreposição na mixagem DJ; 0 = automático */
  blendBars: number;
}

export interface Segment {
  t0: number;
  len: number;
  bpm: number;
  spb: number;
  bar: number;
  bars: number;
}

export const EXIT_LABEL: Record<ExitKind, string> = {
  auto: "Automática (recomendada)",
  blend: "Mixagem DJ (sobrepõe no tempo)",
  corte: "Corte seco no tempo 1",
  vocal: "Suspende e cai (filtro + reverb)",
  riser: "Filtro subindo + riser",
  echo: "Eco saindo",
  rewind: "Rewind",
  rampa: "Rampa de BPM (mantém o tom)",
  fade: "Fade out"
};

export const BAR_OPTIONS = [4, 8, 12, 16, 24, 32];

export const ELEMENT_LABEL: Record<ElementKind, string> = {
  shutter: "Shutter",
  flash: "Flash",
  whoosh: "Whoosh",
  riser: "Riser",
  revcymbal: "Prato invertido",
  impacto: "Impacto",
  subdrop: "Sub drop",
  glitch: "Glitch",
  vinylstop: "Vinyl stop"
};
