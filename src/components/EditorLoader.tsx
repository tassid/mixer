"use client";

import dynamic from "next/dynamic";

/* O editor usa Web Audio, workers e WASM: só existe no navegador. */
const MixEditor = dynamic(() => import("./MixEditor"), {
  ssr: false,
  loading: () => (
    <div className="wrap">
      <header className="intro">
        <h1>Corte no <em>Tempo 1</em></h1>
        <p className="lede">Carregando o estúdio...</p>
      </header>
    </div>
  )
});

export default function EditorLoader() {
  return <MixEditor />;
}
