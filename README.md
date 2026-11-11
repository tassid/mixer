# Mixer

App web para montar mix edits com transições no tempo certo. Você arrasta as músicas, coloca na ordem e o app faz o resto: acha o BPM, as batidas, o tempo 1, o tom e o trecho mais forte de cada música, escolhe a transição pela diferença de andamento e exporta o mix em WAV ou MP3.

Tudo roda no navegador. As músicas não são enviadas para nenhum servidor.

## Rodar no Windows

1. Instale o Node.js 20 ou mais novo (https://nodejs.org, versão LTS).
2. Abra o terminal na pasta do projeto e rode:

```
npm install
npm run dev
```

3. Abra http://localhost:3000 no Chrome ou no Edge.

Para publicar na internet, importe este repositório na Vercel (https://vercel.com/new). Não precisa configurar nada.

## Como usar

1. Arraste as músicas para a área de upload (MP3, WAV, M4A, FLAC ou OGG).
2. Arraste o número de cada música para mudar a ordem.
3. Entre cada par de músicas aparece a transição escolhida, com a diferença de BPM e se os tons combinam. Clique em **Ouvir transição** para conferir.
4. Clique em **Montar mix** e baixe o WAV, o MP3 e os marcadores.

Na onda de cada música, o trecho destacado é o que entra no mix. Arraste o destaque ou clique em outro ponto da onda: ele sempre encaixa no tempo 1. Em **Ajustes finos** dá para mudar a duração do trecho, corrigir o BPM (metade ou dobro), corrigir o tempo 1 e ligar ou desligar o impacto na entrada.

## Transições

| Saída | Quando o modo automático usa |
|---|---|
| Suspende e cai (filtro + reverb) | A próxima música é mais lenta |
| Rampa de BPM | A próxima é de 2% a 9% mais rápida; o andamento sobe sem mudar o tom |
| Filtro subindo + riser | A próxima é bem mais rápida |
| Eco saindo | BPM parecido e tons compatíveis |
| Rewind | BPM parecido e tons distantes |
| Fade out | Final do mix |
| Corte seco no tempo 1 | Só quando você escolhe |

## O que cada biblioteca faz

| Biblioteca | Uso | Licença |
|---|---|---|
| [essentia.js](https://mtg.github.io/essentia.js/) | BPM e batidas (RhythmExtractor2013) e tom (KeyExtractor), em WebAssembly | AGPL-3.0 |
| [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) | Rampa de BPM mantendo o tom | LGPL-2.1 |
| [wavesurfer.js](https://wavesurfer.xyz) | Formas de onda, seleção do trecho e player | BSD-3-Clause |
| [@breezystack/lamejs](https://github.com/breezystack/lamejs) | Exportação em MP3 | LGPL-3.0 |
| [dnd-kit](https://dndkit.com) | Arrastar para reordenar | MIT |
| Web Audio API | Filtros, reverb, eco, impacto e renderização offline do mix | Nativa do navegador |

Como o essentia.js é AGPL, se o app for publicado para outras pessoas usarem, o código precisa continuar aberto (deixar este repositório público já resolve).

## Estrutura

```
src/
  app/                    página e estilos
  components/
    MixEditor.tsx         estado do mix, upload, ordem, prévia e montagem
    TrackCard.tsx         uma música: onda, trecho, saída e ajustes
    TransitionRow.tsx     a transição entre duas músicas
    MixResult.tsx         mix pronto, player e downloads
  lib/audio/
    analysis.worker.ts    essentia.js num Web Worker
    analyze.ts            batidas, tempo 1, trecho mais forte
    plan.ts               escolha das transições e linha do tempo
    render.ts             grafo de Web Audio que gera o mix
    stretch.ts            rampa de BPM com SoundTouch
    keys.ts               tom e roda Camelot
    export.ts             WAV, MP3 e marcadores
```

## Limitações

O tempo 1 é detectado pelo grave mais forte do compasso. Em músicas sem bumbo marcado ele pode errar; use **O tempo 1 está errado** para corrigir. A detecção do trecho mais forte usa energia, então às vezes escolhe um verso intenso no lugar do refrão; basta arrastar o destaque.
