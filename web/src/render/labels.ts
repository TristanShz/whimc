// Labels, drawn by sigma on its 2D canvas over the WebGL layers. They follow
// the same fades as their node, and fade in later than it so that a level
// arriving does not flood the Map with text.

import type { NodeLabelDrawingFunction } from "sigma/rendering";
import { displayedFade, type NodeAttributes } from "./attributes";
import { clock, type Frame } from "./frame";
import { toCss, type Rgb } from "./scales";

export const FONTS = {
  sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono Variable", ui-monospace, monospace',
};

type LabelData = Parameters<NodeLabelDrawingFunction>[1] & NodeAttributes;

const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** How much of a label shows: Package names stay as territory names. */
function labelAlpha(frame: Frame, d: LabelData): number {
  const weight = frame.levelWeights[d.level] ?? 0;
  const fade = displayedFade(d, clock());
  return d.level === 0 ? fade * Math.max(weight, 0.6) : fade * weight * weight;
}

function font(d: LabelData, radiusPx: number): { css: string; size: number } {
  if (d.level === 0) {
    const size = Math.round(Math.min(20, Math.max(12, 10 + radiusPx * 0.07)));
    return { css: `600 ${size}px ${FONTS.sans}`, size };
  }
  if (d.level === 1) return { css: `500 12px ${FONTS.mono}`, size: 12 };
  return { css: `450 11px ${FONTS.mono}`, size: 11 };
}

/**
 * Draws a centred label with a halo, unless another label already holds its
 * place this frame; a forced label (focus, selection, search) always draws.
 */
function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  frame: Frame,
  color: Rgb,
  alpha: number,
  size: number,
  forced: boolean,
) {
  const w = ctx.measureText(text).width;
  const box = {
    x0: x - w / 2,
    y0: y - size,
    x1: x + w / 2,
    y1: y + size * 0.3,
  };
  if (!frame.labels.claim(box) && !forced) return;
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = rgba(frame.palette.halo, Math.min(1, alpha * 0.9));
  ctx.strokeText(text, x, y);
  ctx.fillStyle = rgba(color, alpha);
  ctx.fillText(text, x, y);
}

export function createLabelDrawer(frame: Frame): NodeLabelDrawingFunction {
  return (ctx, data) => {
    const d = data as LabelData;
    if (!d.label) return;
    const alpha = labelAlpha(frame, d);
    if (alpha < 0.06) return;
    const r = Math.max(d.size, frame.minRadiusPx);
    const f = font(d, r);
    ctx.font = f.css;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const p = frame.palette;
    if (d.level === 0) {
      const width = ctx.measureText(d.label).width;
      // Inside a disc that holds it, else under it while Packages are in
      // view, and above it, muted, as a territory name once they are context.
      const inView = frame.levelWeights[0] > 0.6;
      if (inView && r > width / 2 + 10) {
        haloText(
          ctx,
          d.label,
          d.x,
          d.y + f.size / 3,
          frame,
          p.label,
          alpha,
          f.size,
          d.forceLabel,
        );
      } else if (inView) {
        haloText(
          ctx,
          d.label,
          d.x,
          d.y + r + f.size + 3,
          frame,
          p.label,
          alpha,
          f.size,
          d.forceLabel,
        );
      } else {
        haloText(
          ctx,
          d.label,
          d.x,
          d.y - r - 8,
          frame,
          p.muted,
          alpha,
          f.size,
          d.forceLabel,
        );
      }
      return;
    }
    haloText(
      ctx,
      d.label,
      d.x,
      d.y + r + f.size + 3,
      frame,
      p.label,
      alpha,
      f.size,
      d.forceLabel,
    );
  };
}

/** The hovered node: its label and its measures on a small plate. */
export function createHoverDrawer(frame: Frame): NodeLabelDrawingFunction {
  return (ctx, data) => {
    const d = data as LabelData;
    const p = frame.palette;
    const r = Math.max(d.size, frame.minRadiusPx);
    const title = d.label ?? "";
    const titleFont = `600 13px ${FONTS.sans}`;
    const captionFont = `450 11px ${FONTS.mono}`;
    ctx.font = titleFont;
    const tw = ctx.measureText(title).width;
    ctx.font = captionFont;
    const cw = ctx.measureText(d.caption).width;
    const w = Math.max(tw, cw) + 20;
    const h = 42;
    const x = d.x - w / 2;
    const y = d.y + r + 3;

    ctx.save();
    ctx.shadowColor = p.dark ? "rgba(0,0,0,0.5)" : "rgba(20,30,50,0.18)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = toCss(p.canvas);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba(p.muted, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 8);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = titleFont;
    ctx.fillStyle = toCss(p.label);
    ctx.fillText(title, d.x, y + 18);
    ctx.font = captionFont;
    ctx.fillStyle = toCss(p.muted);
    ctx.fillText(d.caption, d.x, y + 33);
  };
}
