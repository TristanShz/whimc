// The typography of the Map's labels: one voice per level, so that the
// hierarchy reads before a word is read. Packages are named like regions on
// a chart (large, and spaced out once they are only context), Directories
// like districts, Files in the monospace of paths. Pure, so that it can be
// tested without a canvas.

export const FONTS = {
  sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono Variable", ui-monospace, monospace',
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
    const size = Math.round(Math.min(22, Math.max(12.5, 9 + radiusPx * 0.08)));
    return {
      css: font(650, size, FONTS.sans),
      size,
      tracking: size >= 18 ? -0.2 : 0,
      tone: "label",
    };
  }
  if (level === 0) {
    const size = Math.round(Math.min(26, Math.max(13, 8 + radiusPx * 0.03)));
    return {
      css: font(600, size, FONTS.sans),
      size,
      tracking: size * 0.08,
      tone: "muted",
    };
  }
  if (level === 1)
    return {
      css: font(560, 12, FONTS.sans),
      size: 12,
      tracking: 0,
      tone: "label",
    };
  return {
    css: font(450, 11, FONTS.mono),
    size: 11,
    tracking: 0,
    tone: "quiet",
  };
}
