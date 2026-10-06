// Sticky notes shrink their text to fit the note, like a marker on paper.
export type Measure = (text: string, fontSize: number) => number; // width in px of a single line

export function wrap(text: string, fontSize: number, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, fontSize) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function fitFontSize(
  text: string,
  box: { width: number; height: number },
  measure: Measure,
  opts: { min?: number; max?: number; lineHeight?: number } = {},
): number {
  const { min = 6, max = 48, lineHeight = 1.3 } = opts;
  if (!text.trim()) return Math.min(max, 24);
  const fits = (size: number) => {
    const lines = wrap(text, size, box.width, measure);
    const tooWide = lines.some((l) => measure(l, size) > box.width);
    return !tooWide && lines.length * size * lineHeight <= box.height;
  };
  let lo = min;
  let hi = max;
  if (fits(hi)) return hi;
  if (!fits(lo)) return lo;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 2) / 2;
}
