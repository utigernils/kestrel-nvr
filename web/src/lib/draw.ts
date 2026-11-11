import { labelColor, labelName } from './labels';

export interface Rect { x: number; y: number; w: number; h: number }

/** Flaeche, die ein Bild (iw x ih) bei "contain" in einem Rahmen (cw x ch) einnimmt. */
export function fitRect(cw: number, ch: number, iw: number, ih: number): Rect {
  const s = Math.min(cw / iw, ch / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** [label, score, x1, y1, x2, y2] – normiert auf 0..1 */
export type DrawBox = readonly [string, number, number, number, number, number, ...unknown[]];

export function drawBoxes(ctx: CanvasRenderingContext2D, boxes: readonly DrawBox[], r: Rect, dpr: number): void {
  ctx.lineWidth = 2 * dpr;
  ctx.font = `600 ${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const d of boxes) {
    const col = labelColor(d[0]);
    const x = r.x + d[2] * r.w;
    const y = r.y + d[3] * r.h;
    const w = (d[4] - d[2]) * r.w;
    const h = (d[5] - d[3]) * r.h;
    ctx.strokeStyle = col;
    ctx.strokeRect(x, y, w, h);
    const txt = `${labelName(d[0])} ${Math.round(d[1] * 100)}%`;
    const tw = ctx.measureText(txt).width + 10 * dpr;
    const th = 18 * dpr;
    const ty = y - th >= r.y ? y - th : y;
    ctx.fillStyle = col;
    ctx.fillRect(x - dpr, ty, tw, th);
    ctx.fillStyle = '#05050a';
    ctx.fillText(txt, x + 4 * dpr, ty + th / 2 + dpr * 0.5);
  }
}
