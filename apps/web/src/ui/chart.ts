export interface Series {
  color: string;
  values: number[];
}

/** Minimal line chart on a 2D canvas (no dependency). All series share the x axis; y is auto-scaled from zero. */
export function drawChart(cv: HTMLCanvasElement, series: Series[], opts: { yMax?: number; bars?: number[]; x0: number; x1: number; unit: string }): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const w = cv.width;
  const h = cv.height;
  g.clearRect(0, 0, w, h);
  const padL = 28;
  const padB = 14;
  const pw = w - padL - 4;
  const ph = h - padB - 4;
  let max = opts.yMax ?? 1;
  if (opts.yMax === undefined) for (const s of series) for (const v of s.values) if (v > max) max = v;
  max = opts.yMax ?? Math.ceil((max * 1.1) / 10) * 10;
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = '10px system-ui, sans-serif';
  g.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = 4 + ph - (ph * i) / 2;
    g.beginPath();
    g.moveTo(padL, y + 0.5);
    g.lineTo(w - 4, y + 0.5);
    g.stroke();
    g.fillText(String(Math.round((max * i) / 2 * (opts.yMax === 1 ? 100 : 1))), 2, y + 3);
  }
  g.fillText(`${opts.unit} ${opts.x0.toFixed(0)}`, padL, h - 2);
  const end = `${opts.x1.toFixed(0)}`;
  g.fillText(end, w - 6 - g.measureText(end).width, h - 2);
  if (opts.bars && opts.bars.length > 1) {
    const bm = Math.max(1, ...opts.bars);
    g.fillStyle = 'rgba(120,170,255,0.35)';
    const bw = pw / opts.bars.length;
    opts.bars.forEach((b, i) => g.fillRect(padL + i * bw, 4 + ph - (b / bm) * ph * 0.6, Math.max(1, bw), (b / bm) * ph * 0.6));
  }
  g.lineWidth = 1.6;
  for (const s of series) {
    const n = s.values.length;
    if (n < 2) continue;
    g.strokeStyle = s.color;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = padL + (i / (n - 1)) * pw;
      const y = 4 + ph - Math.min(1, s.values[i]! / max) * ph;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}
