// The renderer's palette, read from the CSS tokens of style.css so that the
// light and dark themes are defined in one place.

import { useEffect, useState } from "react";
import { parseColor, type Palette, type Rgb } from "./scales";

const TOKENS = [
  "canvas",
  "label",
  "halo",
  "muted",
  "edge",
  "cool",
  "warm",
  "hot",
  "focus",
  "added",
  "modified",
  "removed",
] as const;

const DARK = "(prefers-color-scheme: dark)";

export function readPalette(el: Element = document.documentElement): Palette {
  const css = getComputedStyle(el);
  const color = (name: string): Rgb =>
    parseColor(css.getPropertyValue(`--${name}`)) ?? [128, 128, 128];
  const p = Object.fromEntries(TOKENS.map((t) => [t, color(t)])) as Record<
    (typeof TOKENS)[number],
    Rgb
  >;
  return { ...p, dark: window.matchMedia(DARK).matches };
}

/** The palette, read again when the system switches between light and dark. */
export function usePalette(): Palette {
  const [palette, setPalette] = useState(readPalette);
  useEffect(() => {
    const mq = window.matchMedia(DARK);
    const update = () => setPalette(readPalette());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return palette;
}

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setReduced(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
