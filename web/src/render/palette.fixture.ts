// A palette for tests: the shape of the one theme.ts reads from the tokens.

import type { Palette } from "./scales";

export const testPalette: Palette = {
  dark: true,
  canvas: [11, 13, 16],
  surface: [17, 19, 23],
  label: [213, 216, 221],
  halo: [11, 13, 16],
  muted: [155, 161, 170],
  edge: [160, 167, 180],
  churn: [
    [114, 130, 149],
    [149, 142, 136],
    [183, 152, 120],
    [216, 162, 98],
    [250, 171, 63],
  ],
  focus: [241, 243, 245],
  match: [110, 155, 255],
  added: [76, 195, 138],
  modified: [234, 197, 79],
  removed: [229, 72, 77],
};
