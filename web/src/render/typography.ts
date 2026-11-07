// The typography of the Map's labels: one face, Inter, and a hierarchy
// carried by weight and tone rather than by size: Packages a little larger
// and firmer, Directories at 12/500, Files lighter and quieter. Pure, so
// that it can be tested without a canvas.

export const FONTS = {
  sans: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
};

/** Which colour of the palette a label takes. */
export type Tone = "label" | "muted" | "quiet";

export interface Typography {
  /** The canvas font. */
  css: string;
  /** Font size, pixels. */
  size: number;
  /** Letter spacing, pixels. */
  tracking: number;
  tone: Tone;
}

const font = (weight: number, size: number, family: string) =>
  `${weight} ${size}px ${family}`;

/**
 * How a label is set: by its level, the radius of its disc on screen, and
 * whether the Packages are still the level in view (a Package name then
 * labels a disc; afterwards it names the territory the levels below fill).
 */
export function typography(
  level: number,
  radiusPx: number,
  packagesInView: boolean,
): Typography {
  if (level === 0 && packagesInView) {
    const size = radiusPx >= 120 ? 14 : 13;
    return {
      css: font(600, size, FONTS.sans),
      size,
      tracking: -0.1,
      tone: "label",
    };
  }
  if (level === 0)
    return {
      css: font(600, 13, FONTS.sans),
      size: 13,
      tracking: 0,
      tone: "muted",
    };
  if (level === 1)
    return {
      css: font(500, 12, FONTS.sans),
      size: 12,
      tracking: 0,
      tone: "label",
    };
  return {
    css: font(450, 12, FONTS.sans),
    size: 12,
    tracking: 0,
    tone: "quiet",
  };
}
