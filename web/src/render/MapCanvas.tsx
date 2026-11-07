// The Map's WebGL canvas: sigma drawing a graphology graph kept in line with
// the view state. It draws what computeView returns and reports what the
// user does to the camera and the pointer; it decides nothing else.

import Graph from "graphology";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import Sigma from "sigma";
import type { Rect } from "../api/types";
import type { Camera, LevelBlend, ViewState } from "../viewState";
import { LEVEL_INDEX } from "./attributes";
import { cameraFrom, flipY, frameArea, type Insets } from "./camera";
import { clock, createFrame, type Frame } from "./frame";
import { syncGraph, type MapGraph } from "./graphSync";
import {
  LABEL_MARGIN_PX,
  LabelIndex,
  labelOrder,
  type LabelCandidate,
} from "./labelBoxes";
import {
  FONTS,
  beginLabels,
  clearLabelSprites,
  flushLabels,
  createHoverDrawer,
  createLabelDrawer,
} from "./labels";
import type { NodeLabelDrawingFunction } from "sigma/rendering";
import {
  createEdgeProgram,
  createHoverNodeProgram,
  createNodeProgram,
} from "./programs";
import type { Palette } from "./scales";

/** How to frame an area: see frameArea. */
export interface FrameOptions {
  /** The share of the clear part of the screen the area fills. */
  margin?: number;
  /** Screen pixels the panels over the Map take along each edge. */
  insets?: Insets;
  /** Go at least this close, in screen pixels per map unit. */
  minZoom?: number;
  /** Go no closer than this, unless minZoom asks to. */
  maxZoom?: number;
}

export interface MapHandle {
  zoomIn(): void;
  zoomOut(): void;
  /** Brings the whole Map back into view, clear of the panels. */
  fit(): void;
  /** Brings an area of the Map, in map coordinates, into view. */
  flyTo(area: Rect, options?: FrameOptions): void;
}

export interface MapCanvasProps {
  view: ViewState;
  palette: Palette;
  /** The area of the whole Map: it frames the camera, once known. */
  bounds: Rect | null;
  /** The level blend at a zoom, for the frames between two view states. */
  blend: (zoom: number) => LevelBlend;
  reducedMotion: boolean;
  /** The screen edges the panels over the Map take, to frame it clear of them. */
  insets(): Insets;
  onCamera(camera: Camera): void;
  onHover(id: string | null): void;
  onSelect(id: string | null): void;
  /** A Module was double-clicked: bring its inside into view. */
  onDive(id: string): void;
  /** WebGL could not start. */
  onFailure(message: string): void;
  ref?: Ref<MapHandle>;
}

const MAX_RATIO = 8;
/** The share of the clear screen the whole Map fills when fitted. */
const FIT_MARGIN = 0.94;
const MIN_RATIO = 1e-5;

export function MapCanvas(props: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const [sigma, setSigma] = useState<Sigma | null>(null);
  const graph = useRef<MapGraph>(new Graph({ type: "directed" }));
  const frame = useRef<Frame>(createFrame(props.palette));
  const labelIndex = useRef(new LabelIndex());
  // The latest props for the handlers bound once at mount.
  const latest = useRef(props);
  latest.current = props;
  const framed = useRef(false);
  // Reports the camera now; set once sigma is up.
  const emitCamera = useRef<() => void>(() => {});
  const updateUniforms = useRef<() => unknown>(() => null);

  // Mount sigma once.
  useEffect(() => {
    const el = container.current!;
    const f = frame.current;
    const drawLabel = createLabelDrawer(f);
    let s: Sigma;
    try {
      s = new Sigma(graph.current, el, {
        nodeProgramClasses: { disc: createNodeProgram(f) },
        // The hovered node is not drawn again over the others: a parent would
        // cover its children. Its ring and its plate are the hover.
        nodeHoverProgramClasses: { disc: createHoverNodeProgram(f) },
        edgeProgramClasses: { dependency: createEdgeProgram(f) },
        defaultNodeType: "disc",
        defaultEdgeType: "dependency",
        defaultDrawNodeHover: createHoverDrawer(f),
        // Labels are drawn by drawLabels: sigma's label grid drops the
        // labels of mid-sized discs next to big ones.
        renderLabels: false,
        itemSizesReference: "positions",
        zoomToSizeRatioFunction: (ratio) => ratio,
        zIndex: true,
        stagePadding: 0,
        labelFont: FONTS.sans,
        enableEdgeEvents: false,
        renderEdgeLabels: false,
        minCameraRatio: MIN_RATIO,
        maxCameraRatio: MAX_RATIO,
        zoomingRatio: 1.5,
        allowInvalidContainer: true,
      });
    } catch (e) {
      latest.current.onFailure(e instanceof Error ? e.message : String(e));
      return;
    }

    s.on("afterRender", () => {
      drawLabels(s, graph.current, labelIndex.current, f, drawLabel);
      // Labels left for the next frame: draw it.
      if (f.labelsPending) s.scheduleRender();
    });
    s.on("enterNode", ({ node }) => latest.current.onHover(node));
    s.on("leaveNode", () => latest.current.onHover(null));
    s.on("clickNode", ({ node }) => latest.current.onSelect(node));
    s.on("clickStage", () => latest.current.onSelect(null));
    s.on("doubleClickNode", (e) => {
      // Dive into the Module rather than zoom on the pointer.
      e.preventSigmaDefault();
      latest.current.onDive(e.node);
    });

    // The level blend as uniforms, from the live camera.
    const uniforms = () => {
      const { width, height } = s.getDimensions();
      // Before the Map is framed, the scale is sigma's guess.
      if (!width || !height || !framed.current) return null;
      const cam = cameraFrom(
        { width, height },
        flipY(s.viewportToGraph({ x: 0, y: 0 })),
        flipY(s.viewportToGraph({ x: width, y: height })),
      );
      const blend = latest.current.blend(cam.zoom);
      f.levelWeights = [
        blend.weights.packages,
        blend.weights.directories,
        blend.weights.files,
      ];
      f.childReveal = [
        blend.childReveal.packages,
        blend.childReveal.directories,
        blend.childReveal.files,
      ];
      f.pickLevel = LEVEL_INDEX[blend.level];
      return cam;
    };
    updateUniforms.current = uniforms;

    // Every camera frame: the uniforms, then the camera for the view state.
    let pending = 0;
    const onCamera = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const cam = uniforms();
        if (!cam) return;
        s.scheduleRender();
        latest.current.onCamera(cam);
      });
    };
    s.getCamera().on("updated", onCamera);
    emitCamera.current = onCamera;
    const resize = new ResizeObserver(() => {
      s.resize();
      s.refresh();
      onCamera();
    });
    resize.observe(el);
    // Labels drawn before the fonts arrive would keep the fallback face.
    void document.fonts?.ready.then(() => {
      clearLabelSprites();
      s.refresh();
    });

    setSigma(s);
    return () => {
      cancelAnimationFrame(pending);
      resize.disconnect();
      s.kill();
      setSigma(null);
    };
  }, []);

  // Frame the camera on the whole Map the first time it is known.
  useEffect(() => {
    if (!sigma || !props.bounds || framed.current) return;
    framed.current = true;
    const b = props.bounds;
    const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.06;
    sigma.setCustomBBox({
      x: [b.x0 - pad, b.x1 + pad],
      y: [-b.y1 - pad, -b.y0 + pad],
    });
    sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    sigma.refresh();
    // The framing changed the scale without moving the camera: no event.
    emitCamera.current();
    // Then clear of the panels, as Fit does, once sigma has drawn with the
    // new framing: its coordinate conversions follow its last render.
    sigma.once("afterRender", () =>
      flyTo(
        sigma,
        b,
        { margin: FIT_MARGIN, insets: latest.current.insets() },
        true,
      ),
    );
    sigma.scheduleRender();
  }, [sigma, props.bounds]);

  // Draw the view state; keep rendering while a fade runs on the GPU. The
  // loop outlives the view state that started it: the next one may change
  // nothing while the fade is still running.
  const fadeUntil = useRef(-Infinity);
  const fadeLoop = useRef(0);
  useEffect(() => {
    if (!sigma) return;
    const f = frame.current;
    f.palette = props.palette;
    // New data may change the blend at the same camera.
    updateUniforms.current();
    const synced = syncGraph(graph.current, props.view, props.palette, clock());
    // The labels are filed before sigma draws the new graph.
    labelIndex.current.rebuild(
      synced.graph.mapNodes((key, a) => ({
        key,
        level: a.level,
        size: a.size,
        forced: a.labelFirst || a.forceLabel,
      })),
    );
    if (synced.graph !== graph.current) {
      graph.current = synced.graph;
      sigma.setGraph(synced.graph);
    }
    fadeUntil.current = Math.max(fadeUntil.current, synced.until);
    if (fadeLoop.current || fadeUntil.current < clock()) return;
    const tick = () => {
      sigma.scheduleRender();
      // One frame past the end, so that the last one drawn is the final state.
      fadeLoop.current =
        clock() < fadeUntil.current + 0.05 ? requestAnimationFrame(tick) : 0;
    };
    fadeLoop.current = requestAnimationFrame(tick);
  }, [sigma, props.view, props.palette]);
  useEffect(() => () => cancelAnimationFrame(fadeLoop.current), []);

  // Under reduced motion, arriving nodes fade in without scaling.
  useEffect(() => {
    frame.current.motion = props.reducedMotion ? 0 : 1;
    sigma?.scheduleRender();
  }, [sigma, props.reducedMotion]);

  useImperativeHandle(
    props.ref,
    () => ({
      zoomIn: () =>
        sigma?.getCamera().animatedZoom({
          factor: 1.6,
          duration: latest.current.reducedMotion ? 0 : 220,
        }),
      zoomOut: () =>
        sigma?.getCamera().animatedUnzoom({
          factor: 1.6,
          duration: latest.current.reducedMotion ? 0 : 220,
        }),
      fit: () => {
        const b = latest.current.bounds;
        if (sigma && b)
          flyTo(
            sigma,
            b,
            { margin: FIT_MARGIN, insets: latest.current.insets() },
            latest.current.reducedMotion,
          );
      },
      flyTo: (area, options = {}) =>
        sigma && flyTo(sigma, area, options, latest.current.reducedMotion),
    }),
    [sigma],
  );

  return <div ref={container} className="map-canvas" />;
}

/** Animates the camera onto an area of the Map. */
function flyTo(
  s: Sigma,
  area: Rect,
  options: FrameOptions,
  reducedMotion: boolean,
) {
  const { width, height } = s.getDimensions();
  const camera = s.getCamera();
  const a = s.graphToViewport({ x: 0, y: 0 });
  const b = s.graphToViewport({ x: 1, y: 0 });
  const zoom = Math.hypot(b.x - a.x, b.y - a.y);
  const frame = frameArea(
    area,
    { width, height },
    options.insets,
    options.margin,
    options.minZoom,
    options.maxZoom,
  );
  const target = s.viewportToFramedGraph(
    s.graphToViewport(flipY(frame.centre)),
  );
  // Sigma's ratio is the inverse of its zoom.
  const ratio = Math.min(
    MAX_RATIO,
    Math.max(MIN_RATIO, (camera.ratio * zoom) / frame.zoom),
  );
  const state = { x: target.x, y: target.y, ratio };
  // An animation of no duration does not land where it is asked to.
  if (reducedMotion) camera.setState(state);
  else void camera.animate(state, { duration: 700, easing: "cubicInOut" });
}

/**
 * Draws the labels on sigma's label layer, after each render: every disc
 * large enough on screen, in the order labelOrder gives, a label dropped
 * only where it collides with one drawn before it.
 */
function drawLabels(
  s: Sigma,
  graph: MapGraph,
  index: LabelIndex,
  f: Frame,
  draw: NodeLabelDrawingFunction,
) {
  f.labels.clear();
  f.labelsPending = false;
  beginLabels();
  const ctx = s.getCanvases().labels?.getContext("2d");
  if (!ctx) return;
  const { width, height } = s.getDimensions();
  const shown = new Map<string, { x: number; y: number; size: number }>();
  const candidates: LabelCandidate[] = [];
  // Only the position and the size on screen: anything more per node
  // (sigma's display data is a copy of every attribute) costs frames.
  const scale = s.scaleSize(1);
  for (const key of index.candidates(f.levelWeights, scale)) {
    if (!graph.hasNode(key)) continue;
    const a = graph.getNodeAttributes(key);
    if (!a.text) continue;
    const p = s.graphToViewport(a);
    const size = a.size * scale;
    const radiusPx = Math.max(size, f.minRadiusPx);
    if (
      p.x + radiusPx < -LABEL_MARGIN_PX ||
      p.x - radiusPx > width + LABEL_MARGIN_PX ||
      p.y + radiusPx < -LABEL_MARGIN_PX ||
      p.y - radiusPx > height + LABEL_MARGIN_PX
    )
      continue;
    shown.set(key, { x: p.x, y: p.y, size });
    candidates.push({
      key,
      level: a.level,
      x: p.x,
      y: p.y,
      radiusPx,
      labelFirst: a.labelFirst,
      forceLabel: a.forceLabel,
    });
  }
  const settings = s.getSettings();
  for (const key of labelOrder(candidates, {
    width,
    height,
    levelInView: f.pickLevel,
  })) {
    draw(
      ctx,
      { ...graph.getNodeAttributes(key), ...shown.get(key)!, key, label: null },
      settings,
    );
  }
  flushLabels(ctx);
}
