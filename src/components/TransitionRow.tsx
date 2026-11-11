"use client";

import { COMPAT_TEXT } from "@/lib/audio/keys";
import type { PlanEntry } from "@/lib/audio/plan";
import { EXIT_LABEL } from "@/lib/audio/types";

interface Props {
  from: PlanEntry;
  to: PlanEntry;
  index: number;
  busy: boolean;
  onPreview: () => void;
}

export default function TransitionRow({ from, to, index, busy, onPreview }: Props) {
  const diff = ((to.seg.bpm / from.seg.bpm - 1) * 100);
  const diffTxt = Math.abs(diff) < 0.5 ? "mesmo BPM" : `${diff > 0 ? "+" : ""}${diff.toFixed(0)}% de BPM`;
  return (
    <li className={`transition compat-${from.keyCompat ?? "mesmo"}`} aria-label={`Transição da música ${index + 1} para a ${index + 2}`}>
      <span className="t-line" aria-hidden="true" />
      <div className="t-body">
        <span className="t-name">{EXIT_LABEL[from.exit]}{to.impact ? " + impacto" : ""}</span>
        <span className="t-meta">{diffTxt} · {from.keyCompat ? COMPAT_TEXT[from.keyCompat] : ""}</span>
      </div>
      <button onClick={onPreview} disabled={busy}>{busy ? "Preparando..." : "Ouvir transição"}</button>
    </li>
  );
}
