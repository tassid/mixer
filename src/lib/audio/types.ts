export const SR = 44100;

export type ExitKind = "auto" | "corte" | "vocal" | "riser" | "echo" | "rewind" | "rampa" | "fade";
export type ResolvedExit = Exclude<ExitKind, "auto">;
export type ImpactMode = "auto" | "sim" | "nao";
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
  impact: ImpactMode;
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
  corte: "Corte seco no tempo 1",
  vocal: "Suspende e cai (filtro + reverb)",
  riser: "Filtro subindo + riser",
  echo: "Eco saindo",
  rewind: "Rewind",
  rampa: "Rampa de BPM (mantém o tom)",
  fade: "Fade out"
};

export const BAR_OPTIONS = [4, 8, 12, 16, 24, 32];
