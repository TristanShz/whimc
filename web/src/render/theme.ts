// The renderer's palette, read from the CSS tokens of style.css so that the
// light and dark themes are defined in one place, and the theme the viewer
// picked (data-theme on the root element, remembered in browser storage).

import { useCallback, useEffect, useState } from "react";
import { CHURN_STEPS, parseColor, type Palette, type Rgb } from "./scales";
import {
  THEME_KEY,
  parseTheme,
  themeAttribute,
  type ThemeChoice,
} from "../ui/themeState";

const TOKENS = [
  "canvas",
  "surface",
  "label",
  "halo",
  "muted",
  "edge",
  "focus",
  "match",
  "added",
  "modified",
  "removed",
] as const;

const DARK = "(prefers-color-scheme: dark)";

/**
 * Reads the palette. The tokens hold `light-dark()` pairs, which a custom
 * property keeps unresolved: each is resolved as the colour of a probe.
 */
export function readPalette(root: HTMLElement = document.documentElement) {
  const probe = document.createElement("span");
  probe.style.display = "none";
  root.appendChild(probe);
  const color = (name: string): Rgb => {
    probe.style.color = `var(--${name})`;
    return parseColor(getComputedStyle(probe).color) ?? [128, 128, 128];
  };
  const p = Object.fromEntries(TOKENS.map((t) => [t, color(t)])) as Record<
    (typeof TOKENS)[number],
    Rgb
  >;
  const churn = Array.from({ length: CHURN_STEPS }, (_, i) =>
    color(`churn-${i + 1}`),
  );
  probe.remove();
  const [r, g, b] = p.canvas;
  const palette: Palette = {
    ...p,
    churn,
    dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 128,
  };
  return palette;
}

/** The palette, read again when the theme changes, by the system or here. */
export function usePalette(): Palette {
  const [palette, setPalette] = useState(() => readPalette());
  useEffect(() => {
    const mq = window.matchMedia(DARK);
    const update = () => setPalette(readPalette());
    mq.addEventListener("change", update);
    const seen = new MutationObserver(update);
    seen.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      mq.removeEventListener("change", update);
      seen.disconnect();
    };
  }, []);
  return palette;
}

/** Browser storage may be off: the theme then follows the system. */
function storedTheme(): ThemeChoice {
  try {
    return parseTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

/** Writes a theme choice on the root element, where the tokens follow it. */
export function applyTheme(choice: ThemeChoice = storedTheme()): void {
  const value = themeAttribute(choice);
  const root = document.documentElement;
  if (value) root.dataset.theme = value;
  else delete root.dataset.theme;
}

/** The theme choice, applied and remembered when it changes. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState(storedTheme);
  const choose = useCallback((next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not remembered: the next view follows the system again.
    }
  }, []);
  return [choice, choose];
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
