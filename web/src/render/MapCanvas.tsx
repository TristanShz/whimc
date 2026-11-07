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
import { cameraFrom, dotGrid, fitRatio, flipY } from "./camera";
import { clock, createFrame, type Frame } from "./frame";
import { syncGraph, type MapGraph } from "./graphSync";
import { FONTS, createHoverDrawer, createLabelDrawer } from "./labels";
import { createEdgeProgram, createNodeProgram } from "./programs";
import type { Palette } from "./scales";

export interface MapHandle {
  zoomIn(): void;
  zoomOut(): void;
  /** Brings the whole Map back into view. */
  fit(): void;
  /** Brings an area of the Map, in map coordinates, into view. */
  flyTo(area: Rect, margin?: number): void;
}

export interface MapCanvasProps {
  view: ViewState;
  palette: Palette;
  /** The area of the whole Map: it frames the camera, once known. */
  bounds: Rect | null;
  /** The level blend at a zoom, for the frames between two view states. */
  blend: (zoom: number) => LevelBlend;
  reducedMotion: boolean;
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
const MIN_RATIO = 1e-5;

export function MapCanvas(props: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const [sigma, setSigma] = useState<Sigma | null>(null);
  const graph = useRef<MapGraph>(new Graph({ type: "directed" }));
  const frame = useRef<Frame>(createFrame(props.palette));
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
    let s: Sigma;
    try {
      s = new Sigma(graph.current, el, {
        nodeProgramClasses: { disc: createNodeProgram(f) },
        edgeProgramClasses: { dependency: createEdgeProgram(f) },
        defaultNodeType: "disc",
        defaultEdgeType: "dependency",
        defaultDrawNodeLabel: createLabelDrawer(f),
        defaultDrawNodeHover: createHoverDrawer(f),
        itemSizesReference: "positions",
        zoomToSizeRatioFunction: (ratio) => ratio,
        zIndex: true,
        stagePadding: 0,
        labelFont: FONTS.sans,
        labelRenderedSizeThreshold: 9,
        labelDensity: 0.6,
        labelGridCellSize: 160,
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

    s.on("beforeRender", () => f.labels.clear());
    s.on("enterNode", ({ node }) => latest.current.onHover(node));
    s.on("leaveNode", () => latest.current.onHover(null));
    s.on("clickNode", ({ node }) => latest.current.onSelect(node));
    s.on("clickStage", () => latest.current.onSelect(null));
    s.on("doubleClickNode", (e) => {
      // Dive into the Module rather than zoom on the pointer.
      e.preventSigmaDefault();
      latest.current.onDive(e.node);
    });

    // The level blend as uniforms and the dot grid, from the live camera.
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
      f.pickLevel = LEVEL_INDEX[blend.level];
      const g = dotGrid(cam.zoom, s.graphToViewport({ x: 0, y: 0 }));
      el.style.setProperty("--grid-size", `${g.size}px`);
      el.style.setProperty("--grid-x", `${g.x}px`);
      el.style.setProperty("--grid-y", `${g.y}px`);
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
    void document.fonts?.ready.then(() => s.refresh());

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
    const until = syncGraph(graph.current, props.view, props.palette, clock());
    fadeUntil.current = Math.max(fadeUntil.current, until);
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

  useImperativeHandle(
    props.ref,
    () => ({
      zoomIn: () =>
        sigma?.getCamera().animatedZoom({
          factor: 1.6,
          duration: latest.current.reducedMotion ? 0 : 280,
        }),
      zoomOut: () =>
        sigma?.getCamera().animatedUnzoom({
          factor: 1.6,
          duration: latest.current.reducedMotion ? 0 : 280,
        }),
      fit: () =>
        sigma?.getCamera().animate(
          { x: 0.5, y: 0.5, ratio: 1, angle: 0 },
          {
            duration: latest.current.reducedMotion ? 0 : 650,
            easing: "cubicInOut",
          },
        ),
      flyTo: (area, margin = 0.85) =>
        sigma && flyTo(sigma, area, margin, latest.current.reducedMotion),
    }),
    [sigma],
  );

  return <div ref={container} className="map-canvas" />;
}

/** Animates the camera onto an area of the Map. */
function flyTo(s: Sigma, area: Rect, margin: number, reducedMotion: boolean) {
  const { width, height } = s.getDimensions();
  const camera = s.getCamera();
  const a = s.graphToViewport({ x: 0, y: 0 });
  const b = s.graphToViewport({ x: 1, y: 0 });
  const zoom = Math.hypot(b.x - a.x, b.y - a.y);
  const centre = flipY({
    x: (area.x0 + area.x1) / 2,
    y: (area.y0 + area.y1) / 2,
  });
  const target = s.viewportToFramedGraph(s.graphToViewport(centre));
  const ratio = Math.min(
    MAX_RATIO,
    Math.max(
      MIN_RATIO,
      fitRatio(camera.ratio, zoom, area, { width, height }, margin),
    ),
  );
  void camera.animate(
    { x: target.x, y: target.y, ratio },
    { duration: reducedMotion ? 0 : 700, easing: "cubicInOut" },
  );
}
