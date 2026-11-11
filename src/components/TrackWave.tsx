"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { claimPlayback, releasePlayback } from "@/lib/player";

export interface TrackWaveHandle {
  playSegment: () => void;
  stop: () => void;
}

interface Props {
  mediaUrl: string;
  peaks: Float32Array;
  duration: number;
  start: number;
  end: number;
  label: string;
  onPickStart: (time: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const TrackWave = forwardRef<TrackWaveHandle, Props>(function TrackWave(
  { mediaUrl, peaks, duration, start, end, label, onPickStart, onPlayingChange },
  ref
) {
  const box = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const region = useRef<Region | null>(null);
  const pick = useRef(onPickStart);
  const playingCb = useRef(onPlayingChange);
  const range = useRef({ start, end });
  useEffect(() => {
    pick.current = onPickStart;
    playingCb.current = onPlayingChange;
    range.current = { start, end };
  });

  const stop = useRef(() => { ws.current?.pause(); });

  useEffect(() => {
    if (!box.current) return;
    const stopFn = stop.current;
    const media = new Audio();
    media.preload = "auto";
    media.src = mediaUrl;
    const regions = RegionsPlugin.create();
    const w = WaveSurfer.create({
      container: box.current,
      height: 72,
      waveColor: cssVar("--wave"),
      progressColor: cssVar("--wave-played"),
      cursorColor: cssVar("--fg"),
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      media,
      peaks: [peaks],
      duration,
      dragToSeek: false,
      plugins: [regions]
    });
    ws.current = w;
    // a região só aparece depois que a forma de onda está pronta
    w.on("ready", () => {
      region.current = regions.addRegion({
        start: range.current.start,
        end: range.current.end,
        drag: true,
        resize: false,
        color: cssVar("--sel")
      });
    });
    regions.on("region-updated", (reg) => pick.current(reg.start));
    w.on("interaction", (t) => pick.current(t));
    w.on("play", () => { claimPlayback(stopFn); playingCb.current?.(true); });
    w.on("pause", () => { releasePlayback(stopFn); playingCb.current?.(false); });

    const recolor = () => {
      w.setOptions({ waveColor: cssVar("--wave"), progressColor: cssVar("--wave-played"), cursorColor: cssVar("--fg") });
      region.current?.setOptions({ color: cssVar("--sel") });
    };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", recolor);
    return () => {
      mq.removeEventListener("change", recolor);
      releasePlayback(stopFn);
      w.destroy();
      media.src = "";
      ws.current = null;
      region.current = null;
    };
  }, [mediaUrl, peaks, duration]);

  useEffect(() => {
    region.current?.setOptions({ start, end });
  }, [start, end]);

  useImperativeHandle(ref, () => ({
    playSegment: () => {
      const w = ws.current;
      if (!w) return;
      if (w.isPlaying()) { w.pause(); return; }
      w.play(range.current.start, range.current.end);
    },
    stop: () => ws.current?.pause()
  }), []);

  return <div ref={box} className="wave" role="img" aria-label={label} />;
});

export default TrackWave;
