"use client";

import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import TrackWave, { type TrackWaveHandle } from "./TrackWave";
import { camelot, keyName } from "@/lib/audio/keys";
import { formatTime } from "@/lib/audio/export";
import { BAR_OPTIONS, EXIT_LABEL, type ExitKind, type ImpactMode, type Segment, type Track } from "@/lib/audio/types";

export type TrackAction =
  | { type: "move"; dir: -1 | 1 }
  | { type: "remove" }
  | { type: "pick"; time: number }
  | { type: "nudge"; dir: -1 | 1 }
  | { type: "bars"; bars: number }
  | { type: "mul"; mul: 0.5 | 2 }
  | { type: "phase" }
  | { type: "exit"; exit: ExitKind }
  | { type: "impact"; impact: ImpactMode };

interface Props {
  track: Track;
  index: number;
  count: number;
  seg: Segment;
  peaks: Float32Array;
  resolvedExitNote: string | null;
  onAction: (a: TrackAction) => void;
}

export default function TrackCard({ track, index, count, seg, peaks, resolvedExitNote, onAction }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: track.id });
  const wave = useRef<TrackWaveHandle>(null);
  const [playing, setPlaying] = useState(false);
  const last = index === count - 1;
  const cam = camelot(track.analysis.key, track.analysis.scale);

  return (
    <li
      ref={setNodeRef}
      className={`track${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="num">
        <button
          ref={setActivatorNodeRef}
          className="handle"
          aria-label={`Arrastar ${track.name} para mudar a ordem`}
          {...attributes}
          {...listeners}
        >
          {index + 1}
        </button>
        <button className="mini" aria-label="Subir na ordem" disabled={index === 0} onClick={() => onAction({ type: "move", dir: -1 })}>▲</button>
        <button className="mini" aria-label="Descer na ordem" disabled={last} onClick={() => onAction({ type: "move", dir: 1 })}>▼</button>
      </div>

      <div className="tbody">
        <div className="thead">
          <span className="tname">{track.name}</span>
          <span className="chips">
            {track.example && <span className="chip ex">exemplo</span>}
            <span className="chip hot">{seg.bpm.toFixed(1)} BPM</span>
            <span className="chip" title="Tom estimado e código Camelot">{keyName(track.analysis.key, track.analysis.scale)} · {cam}</span>
            <span className="chip">{seg.bars} compassos · {seg.len.toFixed(1)} s</span>
          </span>
        </div>

        <TrackWave
          ref={wave}
          mediaUrl={track.mediaUrl}
          peaks={peaks}
          duration={track.duration}
          start={seg.t0}
          end={seg.t0 + seg.len}
          label={`Forma de onda de ${track.name}. Clique ou arraste o trecho destacado para mudar onde ele começa.`}
          onPickStart={(t) => onAction({ type: "pick", time: t })}
          onPlayingChange={setPlaying}
        />
        <p className="hint">
          Trecho de {formatTime(seg.t0)} a {formatTime(seg.t0 + seg.len)}. Arraste o destaque ou clique na onda; ele sempre encaixa no tempo 1.
        </p>

        <div className="row">
          <button onClick={() => wave.current?.playSegment()}>{playing ? "Parar" : "Ouvir trecho"}</button>
          {!last && (
            <label>
              Saída
              <select id={`exit-${track.id}`} value={track.exit} onChange={(e) => onAction({ type: "exit", exit: e.target.value as ExitKind })}>
                {(Object.keys(EXIT_LABEL) as ExitKind[]).map((k) => (
                  <option key={k} value={k}>{EXIT_LABEL[k]}</option>
                ))}
              </select>
            </label>
          )}
          {last && (
            <label>
              Final
              <select id={`exit-${track.id}`} value={track.exit} onChange={(e) => onAction({ type: "exit", exit: e.target.value as ExitKind })}>
                <option value="auto">Fade out (recomendado)</option>
                <option value="corte">Corte seco</option>
                <option value="echo">Eco saindo</option>
                <option value="vocal">Suspende com reverb</option>
              </select>
            </label>
          )}
          {resolvedExitNote && <span className="auto-note">{resolvedExitNote}</span>}
        </div>

        <details>
          <summary>Ajustes finos</summary>
          <div className="row">
            <label>
              Duração do trecho
              <select id={`bars-${track.id}`} value={track.bars} onChange={(e) => onAction({ type: "bars", bars: +e.target.value })}>
                {BAR_OPTIONS.map((b) => <option key={b} value={b}>{b} compassos</option>)}
              </select>
            </label>
            <button onClick={() => onAction({ type: "nudge", dir: -1 })}>◀ 1 compasso</button>
            <button onClick={() => onAction({ type: "nudge", dir: 1 })}>1 compasso ▶</button>
          </div>
          <div className="row">
            <button onClick={() => onAction({ type: "mul", mul: 0.5 })}>BPM ÷ 2</button>
            <button onClick={() => onAction({ type: "mul", mul: 2 })}>BPM × 2</button>
            <button onClick={() => onAction({ type: "phase" })}>O tempo 1 está errado</button>
            <span className="auto-note">Confiança do BPM: {track.analysis.confidence >= 3 ? "alta" : track.analysis.confidence >= 1.5 ? "média" : "baixa"}</span>
          </div>
          <div className="row">
            <label>
              Entrada desta música
              <select id={`imp-${track.id}`} value={track.impact} onChange={(e) => onAction({ type: "impact", impact: e.target.value as ImpactMode })}>
                <option value="auto">Impacto automático</option>
                <option value="sim">Com impacto</option>
                <option value="nao">Sem impacto</option>
              </select>
            </label>
            <button className="danger" onClick={() => onAction({ type: "remove" })}>Remover música</button>
          </div>
        </details>
      </div>
    </li>
  );
}
