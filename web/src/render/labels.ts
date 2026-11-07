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
 * Draws a centred label with a halo at the first of its places (baselines)
 * no label drawn before it holds this frame; a label with no free place is
 * left out, unless forced (focus, selection, search): it then takes its
 * first place.
 */
function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  places: number[],
  frame: Frame,
  color: Rgb,
  alpha: number,
  size: number,
  forced: boolean,
) {
  const w = ctx.measureText(text).width;
  const box = (y: number) => ({
    x0: x - w / 2,
    y0: y - size,
    x1: x + w / 2,
    y1: y + size * 0.3,
  });
  let y = places.find((p) => frame.labels.claim(box(p)));
  if (y === undefined) {
    if (!forced) return;
    y = places[0]!;
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = rgba(frame.palette.halo, Math.min(1, alpha * 0.9));
  ctx.strokeText(text, x, y);
  ctx.fillStyle = rgba(color, alpha);
  ctx.fillText(text, x, y);
}

/**
 * The changed-File count of a changed Directory or Package, on a pill at the
 * top right of its disc.
 */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  d: LabelData,
  r: number,
  frame: Frame,
  alpha: number,
) {
  const h = 16;
  ctx.font = `650 10px ${FONTS.sans}`;
  const w = Math.max(h, ctx.measureText(d.badge).width + 10);
  const cx = d.x + r * 0.71;
  const cy = d.y - r * 0.71;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = toCss(frame.palette.halo);
  ctx.stroke();
  ctx.fillStyle = d.badgeColor;
  ctx.fill();
  ctx.fillStyle = toCss(frame.palette.canvas);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(d.badge, cx, cy + 0.5);
  ctx.restore();
}

export function createLabelDrawer(frame: Frame): NodeLabelDrawingFunction {
  return (ctx, data) => {
    const d = data as LabelData;
    if (!d.label) return;
    const alpha = labelAlpha(frame, d);
    if (alpha < 0.06) return;
    const r = Math.max(d.size, frame.minRadiusPx);
    if (d.badge) drawBadge(ctx, d, r, frame, Math.min(1, alpha * 1.4));
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
          [d.y + f.size / 3],
          frame,
          p.label,
          alpha,
          f.size,
          d.labelFirst,
        );
      } else if (inView) {
        haloText(
          ctx,
          d.label,
          d.x,
          [d.y + r + f.size + 3, d.y - r - 6],
          frame,
          p.label,
          alpha,
          f.size,
          d.labelFirst,
        );
      } else {
        haloText(
          ctx,
          d.label,
          d.x,
          [d.y - r - 8],
          frame,
          p.muted,
          alpha,
          f.size,
          d.labelFirst,
        );
      }
      return;
    }
    haloText(
      ctx,
      d.label,
      d.x,
      [d.y + r + f.size + 3, d.y - r - 6],
      frame,
      p.label,
      alpha,
      f.size,
      d.labelFirst,
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
