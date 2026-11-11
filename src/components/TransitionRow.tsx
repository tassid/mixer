"use client";

import { COMPAT_TEXT } from "@/lib/audio/keys";
import type { PlanEntry } from "@/lib/audio/plan";
import { ELEMENT_LABEL, EXIT_LABEL, type ElementKind, type ExitKind } from "@/lib/audio/types";
import type { TrackAction } from "./TrackCard";

interface Props {
  from: PlanEntry;
  to: PlanEntry;
  index: number;
  busy: boolean;
  onPreview: () => void;
  onAction: (a: TrackAction) => void;
}

const STYLE_KEYS: ExitKind[] = ["auto", "blend", "corte", "vocal", "riser", "echo", "rewind", "rampa"];
const BLEND_OPTIONS = [0, 2, 4, 8, 16];

export default function TransitionRow({ from, to, index, busy, onPreview, onAction }: Props) {
  const diff = (to.seg.bpm / from.seg.bpm - 1) * 100;
  const diffTxt = Math.abs(diff) < 0.5 ? "mesmo BPM" : `${diff > 0 ? "+" : ""}${diff.toFixed(0)}% de BPM`;
  const t = from.track;
  const fx = from.fx;
  const toggle = (k: ElementKind) => {
    const next = fx.includes(k) ? fx.filter((x) => x !== k) : [...fx, k];
    onAction({ type: "fx", fx: next });
  };
  const overlapBars = to.preroll?.bars ?? 0;

  return (
    <li className={`transition compat-${from.keyCompat ?? "mesmo"}`} aria-label={`Transição da música ${index + 1} para a ${index + 2}`}>
      <span className="t-line" aria-hidden="true" />
      <div className="t-body">
        <div className="t-top">
          <div className="t-title">
            <span className="t-name">
              {EXIT_LABEL[from.exit]}
              {overlapBars ? `, ${overlapBars} compassos juntas` : ""}
            </span>
            <span className="t-meta">
              {diffTxt} · {from.keyCompat ? COMPAT_TEXT[from.keyCompat] : ""}
              {from.fellBack ? " · o estilo escolhido não coube aqui, usando o mais próximo" : ""}
            </span>
          </div>
          <button onClick={onPreview} disabled={busy}>{busy ? "Preparando..." : "Ouvir transição"}</button>
        </div>

        <div className="row">
          <label>
            Estilo
            <select id={`exit-${t.id}`} value={t.exit} onChange={(e) => onAction({ type: "exit", exit: e.target.value as ExitKind })}>
              {STYLE_KEYS.map((k) => <option key={k} value={k}>{EXIT_LABEL[k]}</option>)}
            </select>
          </label>
          {(from.exit === "blend" || t.exit === "blend") && (
            <label>
              Sobreposição
              <select id={`blend-${t.id}`} value={t.blendBars} onChange={(e) => onAction({ type: "blendBars", bars: +e.target.value })}>
                {BLEND_OPTIONS.map((b) => <option key={b} value={b}>{b === 0 ? "Automática" : `${b} compassos`}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="fx" role="group" aria-label="Elementos da transição">
          <span className="fx-label">Elementos{from.fxAuto ? " (automático)" : ""}</span>
          {(Object.keys(ELEMENT_LABEL) as ElementKind[]).map((k) => (
            <button
              key={k}
              className={`fx-chip${fx.includes(k) ? " on" : ""}`}
              aria-pressed={fx.includes(k)}
              onClick={() => toggle(k)}
            >
              {ELEMENT_LABEL[k]}
            </button>
          ))}
          {!from.fxAuto && (
            <button className="linkish small" onClick={() => onAction({ type: "fx", fx: null })}>voltar ao automático</button>
          )}
        </div>
      </div>
    </li>
  );
}
