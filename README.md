# Mixer

App web para montar mix edits como um DJ. Você arrasta as músicas e o app faz o resto: acha o BPM, as batidas, o tempo 1, o tom e o refrão de cada música, sugere a melhor ordem, coloca a próxima entrando por baixo no mesmo andamento com troca de graves no tempo 1, e exporta o mix em WAV ou MP3. Elementos como shutter, flash e whoosh podem ser somados em cada transição.

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
2. Arraste o número de cada música para mudar a ordem, ou clique em **Ordenar automaticamente**.
3. Entre cada par de músicas aparece a transição: estilo, quantos compassos as duas tocam juntas, diferença de BPM e se os tons combinam. Escolha os elementos que quiser e clique em **Ouvir transição**.
4. Clique em **Montar mix** e baixe o WAV, o MP3 e os marcadores.

Na onda de cada música, os traços marcam as partes detectadas e o destaque é o trecho que entra no mix (por padrão, o refrão). Arraste o destaque ou clique em outro ponto: ele sempre encaixa no tempo 1. Em **Ajustes finos** dá para mudar a duração do trecho e corrigir o BPM ou o tempo 1.

## Como o app decide

**Refrão.** Cada compasso vira um vetor de timbre (bandas mel) e harmonia (croma). A matriz de autossimilaridade mostra onde a música muda de parte e quais trechos se repetem. O trecho escolhido é o que mais se repete com mais energia, começando numa frase de 4 compassos.

**Mixagem DJ.** Quando o BPM das duas músicas difere até 8%, a próxima entra por baixo antes do tempo 1, esticada para o BPM da atual sem mudar o tom (SoundTouch) e sem graves. No tempo 1 os graves trocam de música, a anterior sai em um compasso e a nova segue no andamento original. São 8 compassos juntos quando BPM e tom combinam, 4 quando só o BPM combina e 2 quando os tons são distantes.

**Outros estilos.** Quando a diferença de BPM é maior: se a próxima é mais lenta, suspende com filtro e reverb; se é mais rápida, filtro subindo com riser. Corte seco, eco, rewind e rampa de BPM ficam disponíveis para escolher à mão.

**Ordem automática.** Testa todas as ordens possíveis (até 8 músicas) e escolhe a que junta BPMs próximos e tons compatíveis na roda Camelot, com a energia subindo até o final.

## Elementos

Todos são sintetizados no próprio app e entram no tempo 1 da próxima música: Shutter, Flash, Whoosh, Riser, Prato invertido, Impacto, Sub drop, Glitch (repete o último tempo em semicolcheias) e Vinyl stop (a música desacelera até parar). No modo automático, o impacto entra sozinho depois do riser, do suspende e cai e do rewind.

## O que cada biblioteca faz

| Biblioteca | Uso | Licença |
|---|---|---|
| [essentia.js](https://mtg.github.io/essentia.js/) | BPM e batidas (RhythmExtractor2013) e tom (KeyExtractor), em WebAssembly | AGPL-3.0 |
| [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) | Muda o BPM mantendo o tom (mixagem DJ e rampa) | LGPL-2.1 |
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
    analysis.worker.ts    essentia.js e espectro (mel e croma) num Web Worker
    analyze.ts            batidas, tempo 1, trecho
    structure.ts          partes da música e refrão
    order.ts              ordem automática
    elements.ts           shutter, flash, whoosh e os outros elementos
    plan.ts               escolha das transições e linha do tempo
    render.ts             grafo de Web Audio que gera o mix
    stretch.ts            rampa de BPM com SoundTouch
    keys.ts               tom e roda Camelot
    export.ts             WAV, MP3 e marcadores
```

## Limitações

O tempo 1 é detectado pelo grave mais forte do compasso. Em músicas sem bumbo marcado ele pode errar; use **O tempo 1 está errado** para corrigir. A detecção do refrão é por repetição e energia; em músicas com pouca repetição ela pode escolher outra parte, e basta arrastar o destaque.
