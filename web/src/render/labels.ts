// Labels, drawn by sigma on its 2D canvas over the WebGL layers. They follow
// the same fades as their node, and fade in later than it so that a level
// arriving does not flood the Map with text.
//
// Each label is set once, halo and all, on a small canvas of its own (a
// sprite) and stamped from there every frame: setting text on a canvas costs
// far more than copying pixels, and hundreds of labels move with the camera.

import type { NodeLabelDrawingFunction } from "sigma/rendering";
import { measures } from "../format";
import { displayedFade, type NodeAttributes } from "./attributes";
import { clock, type Frame } from "./frame";
import { toCss, type Palette, type Rgb } from "./scales";
import { FONTS, typography, type Tone } from "./typography";

export { FONTS };

type LabelData = Parameters<NodeLabelDrawingFunction>[1] & NodeAttributes;

const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function toneColor(p: Palette, tone: Tone): Rgb {
  if (tone === "label") return p.label;
  if (tone === "muted") return p.muted;
  // Between the two: Files speak a little lower than Directories.
  return p.label.map((c, i) =>
    Math.round(c * 0.6 + p.muted[i]! * 0.4),
  ) as unknown as Rgb;
}

/** A label as it is set: its text, its typography and its colours. */
interface LabelSet {
  text: string;
  css: string;
  size: number;
  tracking: number;
  color: Rgb;
  halo: Rgb;
}

/** Where a label is set in the atlas, and how to stamp it. */
interface Sprite {
  page: HTMLCanvasElement;
  /** Its place in the page, device pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Size in CSS pixels. */
  width: number;
  height: number;
  /** Where the baseline sits from the sprite's top. */
  baseline: number;
}

/**
 * The atlas: a few large canvases that labels are set into, row by row
 * (shelves of one height). One canvas per label costs more to create than
 * the label costs to set.
 */
const PAGE = 2048;
const MAX_PAGES = 3;
interface Shelf {
  y: number;
  height: number;
  x: number;
}
interface Page {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  shelves: Shelf[];
  top: number;
}
const pages: Page[] = [];

/** Sprites by font, colours and text. */
const sprites = new Map<string, Sprite>();
const widths = new Map<string, number>();
const MAX_WIDTHS = 20000;
/**
 * Sprites set per frame: a level arriving brings hundreds of new labels,
 * set over a few frames (they are fading in) rather than in one long one.
 */
const SPRITES_PER_FRAME = 12;
let budget = SPRITES_PER_FRAME;
/** The halo's spread around the glyphs, pixels. */
const HALO = 3;

let measurer: CanvasRenderingContext2D | null = null;

const keyOf = (l: LabelSet) =>
  `${l.css}|${l.tracking}|${l.color.join()}|${l.halo.join()}|${l.text}`;
const widthKey = (l: LabelSet) => `${l.css}|${l.tracking}|${l.text}`;

/**
 * The width of a label's text, pixels: measured once its sprite is set,
 * estimated until then (measuring the thousands of labels a level brings
 * would take frames; a monospace estimate is exact).
 */
function textWidth(l: LabelSet): number {
  const w = widths.get(widthKey(l));
  if (w !== undefined) return w;
  const em = l.css.includes("Mono") ? 0.6 : 0.56;
  return l.text.length * (l.size * em + l.tracking);
}

function measure(l: LabelSet): number {
  const k = widthKey(l);
  let w = widths.get(k);
  if (w === undefined) {
    if (widths.size > MAX_WIDTHS) widths.clear();
    measurer ??= document.createElement("canvas").getContext("2d");
    const m = measurer!;
    m.font = l.css;
    m.letterSpacing = `${l.tracking}px`;
    w = m.measureText(l.text).width;
    widths.set(k, w);
  }
  return w;
}

/** A free place of w × h device pixels in the atlas, or null when full. */
function allocate(
  w: number,
  h: number,
): { page: Page; x: number; y: number } | null {
  const height = Math.ceil(h / 8) * 8;
  for (const page of pages) {
    for (const shelf of page.shelves)
      if (shelf.height === height && shelf.x + w <= PAGE) {
        const x = shelf.x;
        shelf.x += w + 2;
        return { page, x, y: shelf.y };
      }
    if (page.top + height <= PAGE) {
      const shelf = { y: page.top, height, x: w + 2 };
      page.shelves.push(shelf);
      page.top += height + 2;
      return { page, x: 0, y: shelf.y };
    }
  }
  if (pages.length >= MAX_PAGES) return null;
  const canvas = document.createElement("canvas");
  canvas.width = PAGE;
  canvas.height = PAGE;
  pages.push({ canvas, ctx: canvas.getContext("2d")!, shelves: [], top: 0 });
  return allocate(w, h);
}

/** The label's sprite, or null when this frame has set enough of them. */
function sprite(l: LabelSet): Sprite | null {
  const key = keyOf(l);
  const hit = sprites.get(key);
  if (hit) return hit;
  if (budget <= 0) return null;
  budget--;

  const pad = HALO + 4;
  const width = Math.ceil(measure(l) + pad * 2);
  const height = Math.ceil(l.size * 1.5 + pad * 2);
  const baseline = pad + l.size * 1.1;
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const sw = Math.ceil(width * dpr);
  const sh = Math.ceil(height * dpr);
  let place = allocate(sw, sh);
  if (!place) {
    // The atlas is full: start it again.
    clearLabelSprites();
    place = allocate(sw, sh);
    if (!place) return null;
  }
  const { page, x, y } = place;
  const ctx = page.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, x, y);
  ctx.clearRect(0, 0, width, height);
  ctx.font = l.css;
  ctx.letterSpacing = `${l.tracking}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // A soft halo, then a firm one close to the glyphs, then the text: crisp
  // over discs and Dependencies alike.
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(l.halo, 0.35);
  ctx.lineWidth = HALO * 2.6;
  ctx.strokeText(l.text, pad, baseline);
  ctx.strokeStyle = rgba(l.halo, 0.9);
  ctx.lineWidth = HALO;
  ctx.strokeText(l.text, pad, baseline);
  ctx.fillStyle = toCss(l.color);
  ctx.fillText(l.text, pad, baseline);

  const s = {
    page: page.canvas,
    sx: x,
    sy: y,
    sw,
    sh,
    width,
    height,
    baseline,
  };
  sprites.set(key, s);
  return s;
}

/** Forgets every sprite: the fonts changed. */
export function clearLabelSprites(): void {
  sprites.clear();
  widths.clear();
  for (const p of pages) {
    p.ctx.setTransform(1, 0, 0, 1, 0, 0);
    p.ctx.clearRect(0, 0, PAGE, PAGE);
    p.shelves = [];
    p.top = 0;
  }
}

/** Starts a frame of labels: a fresh budget of sprites to set. */
export function beginLabels(): void {
  budget = SPRITES_PER_FRAME;
}

/** How much of a label shows: Package names stay as territory names. */
function labelAlpha(frame: Frame, d: LabelData): number {
  const weight = frame.levelWeights[d.level] ?? 0;
  const fade = displayedFade(d, clock());
  return d.level === 0 ? fade * Math.max(weight, 0.6) : fade * weight * weight;
}

/**
 * Stamps a centred label at the first of its places (baselines) no label
 * drawn before it holds this frame; a label with no free place is left out,
 * unless forced (focus, selection, search): it then takes its first place.
 */
function stamp(
  l: LabelSet,
  x: number,
  places: number[],
  frame: Frame,
  alpha: number,
  forced: boolean,
) {
  const w = textWidth(l);
  const box = (y: number) => ({
    x0: x - w / 2,
    y0: y - l.size,
    x1: x + w / 2,
    y1: y + l.size * 0.3,
  });
  let y = places.find((p) => frame.labels.claim(box(p)));
  if (y === undefined) {
    if (!forced) return;
    y = places[0]!;
  }
  // Its place is held this frame even before its sprite is set. Stamped
  // once every label of the frame is set (flushLabels): drawing from the
  // atlas between two writes to it stalls the GPU.
  const s = sprite(l);
  if (!s) {
    frame.labelsPending = true;
    return;
  }
  stamps.push({
    s,
    x: Math.round((x - s.width / 2) * 2) / 2,
    y: Math.round((y - s.baseline) * 2) / 2,
    alpha: Math.min(1, alpha),
  });
}

const stamps: { s: Sprite; x: number; y: number; alpha: number }[] = [];

/** Stamps the labels of the frame, set by the label drawer. */
export function flushLabels(ctx: CanvasRenderingContext2D): void {
  for (const { s, x, y, alpha } of stamps) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(s.page, s.sx, s.sy, s.sw, s.sh, x, y, s.width, s.height);
  }
  ctx.globalAlpha = 1;
  stamps.length = 0;
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
    if (!d.text) return;
    const alpha = labelAlpha(frame, d);
    if (alpha < 0.06) return;
    const r = Math.max(d.size, frame.minRadiusPx);
    if (d.badge) drawBadge(ctx, d, r, frame, Math.min(1, alpha * 1.4));
    // Packages in view until the Directories are mostly in.
    const inView = frame.levelWeights[0] > 0.6;
    const t = typography(d.level, r, inView);
    const p = frame.palette;
    const l: LabelSet = {
      text: d.text,
      css: t.css,
      size: t.size,
      tracking: t.tracking,
      color: toneColor(p, t.tone),
      halo: p.halo,
    };
    const below = d.y + r + t.size + 3;
    const above = d.y - r - 6;
    if (d.level === 0 && inView && r > textWidth(l) / 2 + 10) {
      // Inside a disc that holds it.
      stamp(l, d.x, [d.y + t.size / 3], frame, alpha, d.labelFirst);
    } else if (d.level === 0 && !inView) {
      // Above it, as a territory name once the Packages are context.
      stamp(l, d.x, [d.y - r - 10], frame, alpha, d.labelFirst);
    } else {
      stamp(l, d.x, [below, above], frame, alpha, d.labelFirst);
    }
  };
}

/** The hovered node: its label and its measures on a small plate. */
export function createHoverDrawer(frame: Frame): NodeLabelDrawingFunction {
  return (ctx, data) => {
    const d = data as LabelData;
    const p = frame.palette;
    const r = Math.max(d.size, frame.minRadiusPx);
    const title = d.text ?? "";
    const titleFont = `600 13px ${FONTS.sans}`;
    const captionFont = `450 11px ${FONTS.mono}`;
    ctx.font = titleFont;
    const tw = ctx.measureText(title).width;
    ctx.font = captionFont;
    const caption = measures(d.lines, d.commits);
    const cw = ctx.measureText(caption).width;
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
    ctx.fillText(caption, d.x, y + 33);
  };
}
