"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { claimPlayback, releasePlayback } from "@/lib/player";
import { formatTime, markersCsv, markersText, mp3Blob, saveBlob, wavBlob } from "@/lib/audio/export";
import type { Plan } from "@/lib/audio/plan";
import { EXIT_LABEL } from "@/lib/audio/types";

interface Props { buffer: AudioBuffer; plan: Plan; peaks: Float32Array }

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function MixResult({ buffer, plan, peaks }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [mp3, setMp3] = useState<string | null>(null);
  const wav = useRef<Blob | null>(null);

  useEffect(() => {
    if (!box.current) return;
    wav.current = wavBlob(buffer);
    const url = URL.createObjectURL(wav.current);
    const media = new Audio(url);
    const regions = RegionsPlugin.create();
    const w = WaveSurfer.create({
      container: box.current, height: 110, media, peaks: [peaks], duration: buffer.duration,
      waveColor: cssVar("--wave"), progressColor: cssVar("--accent"), cursorColor: cssVar("--fg"),
      barWidth: 2, barGap: 1, barRadius: 1, plugins: [regions]
    });
    ws.current = w;
    w.on("ready", () => {
      plan.entries.forEach((e, i) => {
        regions.addRegion({ start: e.T, drag: false, resize: false, color: cssVar("--accent"), content: String(i + 1) });
      });
    });
    const stop = () => w.pause();
    w.on("play", () => { claimPlayback(stop); setPlaying(true); });
    w.on("pause", () => { releasePlayback(stop); setPlaying(false); });
    return () => { releasePlayback(stop); w.destroy(); media.src = ""; URL.revokeObjectURL(url); ws.current = null; };
  }, [buffer, plan, peaks]);

  async function downloadMp3() {
    setMp3("Convertendo para MP3: 0%");
    try {
      const blob = await mp3Blob(buffer, (p) => setMp3(`Convertendo para MP3: ${Math.round(p * 100)}%`));
      saveBlob(blob, "mix-edit.mp3");
      setMp3(null);
    } catch (err) {
      setMp3(`Não consegui gerar o MP3 (${(err as Error).message}). O WAV continua disponível.`);
    }
  }

  return (
    <section className="result" aria-labelledby="mix-title">
      <div className="result-head">
        <h2 id="mix-title">Seu mix</h2>
        <span className="est">{formatTime(buffer.duration)} · {plan.entries.length} músicas</span>
      </div>
      <div ref={box} className="mixwave" role="img" aria-label="Forma de onda do mix com marcadores numerados no início de cada música" />
      <div className="row">
        <button className="primary" onClick={() => ws.current?.playPause()}>{playing ? "Pausar" : "Ouvir mix"}</button>
        <button onClick={() => wav.current && saveBlob(wav.current, "mix-edit.wav")}>Baixar WAV</button>
        <button onClick={downloadMp3} disabled={!!mp3 && mp3.startsWith("Convertendo")}>Baixar MP3</button>
        <button onClick={() => saveBlob(new Blob([markersText(plan)], { type: "text/plain" }), "marcadores.txt")}>Marcadores (.txt)</button>
        <button onClick={() => saveBlob(new Blob([markersCsv(plan)], { type: "text/csv" }), "marcadores.csv")}>Marcadores (.csv)</button>
        {mp3 && <span className="status">{mp3}</span>}
      </div>
      <ol className="markers">
        {plan.entries.map((e, i) => (
          <li key={e.track.id}>
            <button className="linkish" onClick={() => { ws.current?.setTime(e.T); ws.current?.play(); }}>{formatTime(e.T)}</button>
            <span>
              {i + 1}. {e.track.name} ({e.seg.bpm.toFixed(1)} BPM)
              {i < plan.entries.length - 1 ? `, sai com ${EXIT_LABEL[e.exit].toLowerCase()}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
