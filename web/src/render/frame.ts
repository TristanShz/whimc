// What the WebGL programs and the label drawer read at each frame and that is
// not in the graph: the level blend, which changes with every zoom step and
// is therefore a uniform rather than a per-node attribute.

import { LabelBoxes } from "./labelBoxes";
import { MIN_RADIUS_PX, type Palette } from "./scales";

export interface Frame {
  /** The view state's level weights: Packages, Directories, Files. */
  levelWeights: [number, number, number];
  /** The level whose nodes the pointer can hover and click. */
  pickLevel: number;
  minRadiusPx: number;
  palette: Palette;
  /** The labels drawn so far this frame. */
  labels: LabelBoxes;
}

const t0 = performance.now();

/** The render clock, in seconds: what fade transitions are timed on. */
export const clock = () => (performance.now() - t0) / 1000;

export function createFrame(palette: Palette): Frame {
  return {
    levelWeights: [1, 0, 0],
    pickLevel: 0,
    minRadiusPx: MIN_RADIUS_PX,
    palette,
    labels: new LabelBoxes(),
  };
}
