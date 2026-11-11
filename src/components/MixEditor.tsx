"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import TrackCard, { type TrackAction } from "./TrackCard";
import TransitionRow from "./TransitionRow";
import MixResult from "./MixResult";
import {
  analyzeBuffer, autoStart, bpmOf, decodeFile, detectPhase, downbeatTime, maxStart, nearestDownbeat, peaksOf, segmentOf
} from "@/lib/audio/analyze";
import { buildPlan, sectionTimes, type Plan } from "@/lib/audio/plan";
import { smartOrder } from "@/lib/audio/order";
import { renderPlan } from "@/lib/audio/render";
import { formatTime, wavBlob } from "@/lib/audio/export";
import { EXAMPLES, synthTrack } from "@/lib/audio/examples";
import { claimPlayback, releasePlayback } from "@/lib/player";
import { EXIT_LABEL, type Segment, type Track } from "@/lib/audio/types";

const AUDIO_RE = /\.(mp3|wav|m4a|flac|aac|ogg|opus)$/i;
let uid = 0;

async function makeTrack(name: string, buffer: AudioBuffer, mediaUrl: string, example: boolean): Promise<Track> {
  const analysis = await analyzeBuffer(buffer);
  const t: Track = {
    id: `t${++uid}`, name, buffer, mediaUrl, peaks: peaksOf(buffer), duration: buffer.duration, example, analysis,
    beatMul: 1, mulByUser: false, phase: 0, bars: 8, startDown: 0, userStart: false, exit: "auto", fx: null, blendBars: 0
  };
  t.phase = detectPhase(t);
  t.startDown = autoStart(t);
  return t;
}

/**
 * Trap costuma ser lido em tempo dobrado (146 em vez de 73). Para comparar andamentos entre músicas,
 * cada faixa ainda não ajustada à mão vai para a "oitava" de BPM mais perto da mediana das outras.
 */
function harmonizeOctaves(list: Track[]): Track[] {
  if (list.length < 2) return list;
  const base = list.map((t) => bpmOf(t)).sort((a, b) => a - b);
  const med = base[Math.floor(base.length / 2)];
  return list.map((t) => {
    if (t.mulByUser) return t;
    const raw = bpmOf({ ...t, beatMul: 1 });
    let best: Track["beatMul"] = 1, bd = Infinity;
    for (const m of [0.5, 1, 2] as Track["beatMul"][]) {
      const b = raw * m;
      if (b < 60 || b > 180) continue;
      const d = Math.abs(Math.log2(b / med)) + (m === 1 ? 0 : 0.08);
      if (d < bd) { bd = d; best = m; }
    }
    if (best === t.beatMul) return t;
    const n = { ...t, beatMul: best };
    n.phase = detectPhase(n);
    n.startDown = t.userStart ? nearestDownbeat(n, downbeatTime(t, t.startDown)) : autoStart(n);
    return n;
  });
}

function applyAction(t: Track, a: TrackAction): Track {
  switch (a.type) {
    case "pick": return { ...t, startDown: nearestDownbeat(t, a.time), userStart: true };
    case "nudge": return { ...t, startDown: Math.max(0, Math.min(maxStart(t), t.startDown + a.dir)), userStart: true };
    case "bars": {
      const n = { ...t, bars: a.bars };
      n.startDown = t.userStart ? Math.min(t.startDown, maxStart(n)) : autoStart(n);
      return n;
    }
    case "mul": {
      const cur = t.beatMul;
      const next = (a.mul === 2 ? (cur === 0.5 ? 1 : 2) : (cur === 2 ? 1 : 0.5)) as Track["beatMul"];
      if (next === cur) return t;
      const oldT0 = downbeatTime(t, t.startDown);
      const n = { ...t, beatMul: next, mulByUser: true };
      n.phase = detectPhase(n);
      n.startDown = t.userStart ? nearestDownbeat(n, oldT0) : autoStart(n);
      return n;
    }
    case "phase": {
      const oldT0 = downbeatTime(t, t.startDown);
      const n = { ...t, phase: (t.phase + 1) % 4 };
      n.startDown = nearestDownbeat(n, oldT0);
      return n;
    }
    case "exit": return { ...t, exit: a.exit };
    case "fx": return { ...t, fx: a.fx };
    case "blendBars": return { ...t, blendBars: a.bars };
    default: return t;
  }
}

export default function MixEditor() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [status, setStatus] = useState<{ msg: string; err?: boolean }>({ msg: "Preparando faixas de exemplo..." });
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [mix, setMix] = useState<{ buffer: AudioBuffer; plan: Plan; peaks: Float32Array } | null>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const previewAudio = useRef<HTMLAudioElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const plan = useMemo(() => (tracks.length ? buildPlan(tracks.map((track) => ({ track }))) : null), [tracks]);

  /* exemplos na primeira visita */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const made: Track[] = [];
        for (const ex of EXAMPLES) {
          const buf = synthTrack(ex.bpm, ex.root, 32, ex.hats16);
          made.push(await makeTrack(ex.name, buf, URL.createObjectURL(wavBlob(buf)), true));
        }
        if (alive) {
          setTracks((cur) => (cur.length ? cur : harmonizeOctaves(made)));
          setStatus({ msg: "Estas são faixas de exemplo geradas pelo app. Adicione suas músicas para substituí-las." });
        }
      } catch (err) {
        if (alive) setStatus({ msg: `O analisador não carregou (${(err as Error).message}). Recarregue a página.`, err: true });
      }
    })();
    return () => { alive = false; };
  }, []);

  const invalidateMix = () => setMix(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("audio") || AUDIO_RE.test(f.name));
    if (!list.length) { setStatus({ msg: "Nenhum arquivo de áudio encontrado. Use MP3, WAV, M4A ou FLAC.", err: true }); return; }
    setLoading(true);
    setMix(null);
    const fails: string[] = [];
    const made: Track[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setStatus({ msg: `Analisando ${i + 1} de ${list.length}: ${f.name} (BPM, batidas e tom)` });
      try {
        const buf = await decodeFile(f);
        made.push(await makeTrack(f.name.replace(/\.[^.]+$/, ""), buf, URL.createObjectURL(f), false));
      } catch {
        fails.push(f.name);
      }
    }
    setTracks((cur) => harmonizeOctaves([...cur.filter((t) => !t.example), ...made]));
    setLoading(false);
    setStatus(
      fails.length
        ? { msg: `Não consegui abrir: ${fails.join(", ")}. Tente converter para MP3 ou WAV.`, err: true }
        : { msg: `${made.length} música(s) prontas. Confira a ordem e ouça as transições.` }
    );
  }, []);

  function onAction(id: string, a: TrackAction) {
    invalidateMix();
    setTracks((cur) => {
      const i = cur.findIndex((t) => t.id === id);
      if (i < 0) return cur;
      if (a.type === "remove") return cur.filter((t) => t.id !== id);
      if (a.type === "move") {
        const j = i + a.dir;
        return j < 0 || j >= cur.length ? cur : arrayMove(cur, i, j);
      }
      const next = [...cur];
      next[i] = applyAction(cur[i], a);
      return next;
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    invalidateMix();
    setTracks((cur) => {
      const from = cur.findIndex((t) => t.id === e.active.id), to = cur.findIndex((t) => t.id === e.over!.id);
      return arrayMove(cur, from, to);
    });
  }

  const stopPreview = useCallback(() => { previewAudio.current?.pause(); }, []);

  async function previewTransition(i: number) {
    if (!plan) return;
    const A = plan.entries[i], B = plan.entries[i + 1];
    const overlap = B.preroll?.bars ?? 0;
    const na = Math.min(A.seg.bars, Math.max(4, overlap + 2)), nb = Math.min(4, B.seg.bars);
    const segA: Segment = { ...A.seg, t0: A.seg.t0 + A.seg.len - na * A.seg.bar, len: na * A.seg.bar, bars: na };
    const segB: Segment = { ...B.seg, len: nb * B.seg.bar, bars: nb };
    setPreviewing(i);
    try {
      const p = buildPlan([
        { track: A.track, seg: segA, exit: A.exit, fx: A.fx },
        { track: B.track, seg: segB, exit: "fade", fx: [] }
      ]);
      // mantém a razão de BPM do mix completo para a rampa
      p.entries[0].ratio = A.ratio;
      const buf = await renderPlan(p);
      const url = URL.createObjectURL(wavBlob(buf));
      setPreview((old) => { if (old) URL.revokeObjectURL(old.url); return { url, label: `Transição ${i + 1} → ${i + 2}: ${EXIT_LABEL[A.exit]}` }; });
    } catch (err) {
      setStatus({ msg: `Não consegui gerar a prévia: ${(err as Error).message}`, err: true });
    }
    setPreviewing(null);
  }

  function reorder() {
    const ids = smartOrder(tracks);
    invalidateMix();
    setTracks((cur) => ids.map((id) => cur.find((t) => t.id === id)!).filter(Boolean));
    setStatus({ msg: "Ordem ajustada: BPM próximo, tons compatíveis e energia subindo até o final." });
  }

  useEffect(() => {
    const a = previewAudio.current;
    if (!a || !preview) return;
    a.src = preview.url;
    a.play().catch(() => {});
  }, [preview]);

  useEffect(() => {
    const a = previewAudio.current;
    if (!a) return;
    const onPlay = () => claimPlayback(stopPreview);
    const onPause = () => releasePlayback(stopPreview);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => { a.removeEventListener("play", onPlay); a.removeEventListener("pause", onPause); };
  }, [stopPreview]);

  async function build() {
    if (!tracks.length) return;
    setBuilding(true);
    setStatus({ msg: "Montando o mix... pode levar alguns segundos." });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const p = buildPlan(tracks.map((track) => ({ track })));
      const buffer = await renderPlan(p);
      setMix({ buffer, plan: p, peaks: peaksOf(buffer, 3000) });
      setStatus({ msg: `Mix pronto: ${formatTime(buffer.duration)}.` });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (err) {
      setStatus({ msg: `Não consegui montar o mix: ${(err as Error).message}`, err: true });
    }
    setBuilding(false);
  }

  const segs = useMemo(() => new Map(tracks.map((t) => [t.id, segmentOf(t)])), [tracks]);

  return (
    <>
      <div className="wrap">
        <header className="intro">
          <h1>Mix<em>er</em></h1>
          <p className="lede">
            Monte um mix edit como um DJ. O app acha o BPM, o tempo 1, o tom e o refrão de cada música, coloca a próxima entrando por baixo no mesmo andamento e troca os graves no tempo certo. Você ainda pode escolher outros estilos e somar elementos como shutter, flash e whoosh. Tudo roda no seu navegador: as músicas não são enviadas para lugar nenhum.
          </p>
          <ol className="steps">
            <li>Adicione as músicas</li>
            <li>Ordene (ou deixe o app ordenar)</li>
            <li>Ouça as transições e monte o mix</li>
          </ol>
        </header>

        <div
          className={`drop${over ? " over" : ""}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        >
          <div>
            <strong>Arraste suas músicas aqui</strong>
            <p>MP3, WAV, M4A, FLAC ou OGG. Pode soltar todas de uma vez.</p>
          </div>
          <button className="primary" onClick={() => fileInput.current?.click()} disabled={loading}>
            {loading ? "Analisando..." : "Escolher arquivos"}
          </button>
          <input
            ref={fileInput}
            id="file-input"
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.flac,.aac,.ogg,.opus"
            multiple
            hidden
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        <p className={`status${status.err ? " err" : ""}`} role="status" aria-live="polite">{status.msg}</p>

        {plan && tracks.length > 2 && (
          <div className="toolbar">
            <button onClick={reorder}>Ordenar automaticamente</button>
            <span className="auto-note">Junta BPMs próximos e tons que combinam, com a energia subindo até o final.</span>
          </div>
        )}

        {plan && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ol className="list">
                {tracks.map((t, i) => {
                  const e = plan.entries[i];
                  const note = t.exit === "auto"
                    ? `Vai usar: ${EXIT_LABEL[e.exit]}`
                    : e.fellBack ? `Diferença de BPM grande demais para rampa; usando ${EXIT_LABEL[e.exit]}` : null;
                  return (
                    <Fragment key={t.id}>
                      <TrackCard
                        track={t}
                        index={i}
                        count={tracks.length}
                        seg={segs.get(t.id)!}
                        peaks={t.peaks}
                        resolvedExitNote={note}
                        sections={sectionTimes(t)}
                        onAction={(a) => onAction(t.id, a)}
                      />
                      {i < tracks.length - 1 && (
                        <TransitionRow
                          from={e}
                          to={plan.entries[i + 1]}
                          index={i}
                          busy={previewing === i}
                          onPreview={() => previewTransition(i)}
                          onAction={(a) => onAction(t.id, a)}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </ol>
            </SortableContext>
          </DndContext>
        )}

        <div ref={resultRef}>{mix && <MixResult buffer={mix.buffer} plan={mix.plan} peaks={mix.peaks} />}</div>
      </div>

      <div className="bar">
        <div className="bar-in">
          <div className="now">
            <span className="lbl">{preview ? preview.label : "As prévias de transição tocam aqui"}</span>
            <audio ref={previewAudio} controls className="preview-audio" aria-label="Prévia da transição" />
          </div>
          <span className="est">{plan ? `${tracks.length} músicas · ${formatTime(plan.total - 3)}` : ""}</span>
          <button className="primary big" onClick={build} disabled={!tracks.length || building || loading}>
            {building ? "Montando..." : "Montar mix"}
          </button>
        </div>
      </div>
    </>
  );
}
