/* Garante que só uma coisa toque por vez (trecho, prévia de transição ou mix). */
let current: (() => void) | null = null;

export function claimPlayback(stop: () => void) {
  if (current && current !== stop) current();
  current = stop;
}

export function releasePlayback(stop: () => void) {
  if (current === stop) current = null;
}
