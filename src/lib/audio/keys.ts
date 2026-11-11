/* Tom e roda Camelot. */

const PT: Record<string, string> = {
  C: "Dó", "C#": "Dó♯", Db: "Ré♭", D: "Ré", "D#": "Ré♯", Eb: "Mi♭", E: "Mi", F: "Fá", "F#": "Fá♯",
  Gb: "Sol♭", G: "Sol", "G#": "Sol♯", Ab: "Lá♭", A: "Lá", "A#": "Lá♯", Bb: "Si♭", B: "Si"
};

const CAMELOT_MAJOR: Record<string, string> = {
  B: "1B", "F#": "2B", Gb: "2B", "C#": "3B", Db: "3B", "G#": "4B", Ab: "4B", "D#": "5B", Eb: "5B",
  "A#": "6B", Bb: "6B", F: "7B", C: "8B", G: "9B", D: "10B", A: "11B", E: "12B"
};
const CAMELOT_MINOR: Record<string, string> = {
  "G#": "1A", Ab: "1A", "D#": "2A", Eb: "2A", "A#": "3A", Bb: "3A", F: "4A", C: "5A", G: "6A",
  D: "7A", A: "8A", E: "9A", B: "10A", "F#": "11A", Gb: "11A", "C#": "12A", Db: "12A"
};

export function camelot(key: string, scale: "major" | "minor"): string {
  return (scale === "minor" ? CAMELOT_MINOR : CAMELOT_MAJOR)[key] ?? "?";
}

export function keyName(key: string, scale: "major" | "minor"): string {
  return `${PT[key] ?? key} ${scale === "minor" ? "menor" : "maior"}`;
}

export type Compat = "mesmo" | "vizinho" | "distante";

export function compat(a: string, b: string): Compat {
  if (a === "?" || b === "?") return "distante";
  if (a === b) return "mesmo";
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  const la = a.slice(-1), lb = b.slice(-1);
  if (na === nb) return "vizinho";
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  if (la === lb && d === 1) return "vizinho";
  return "distante";
}

export const COMPAT_TEXT: Record<Compat, string> = {
  mesmo: "Mesmo tom: dá até para sobrepor as duas",
  vizinho: "Tons vizinhos: soam bem juntos",
  distante: "Tons distantes: o app usa sobreposição curta ou corte"
};
