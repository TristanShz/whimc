// The Overview panel's words and state: the language split as shares of
// Size, and whether the panel starts open.

import type { Language, Overview } from "../api/types";

/** The localStorage key holding "open" or "closed". */
export const OVERVIEW_KEY = "whimc.overview";

const LANGUAGE_NAMES: Record<Language, string> = { ts: "TS/JS", go: "Go" };

export interface LanguageShare {
  language: Language;
  name: string;
  /** Its lines. */
  size: number;
  /** Share of the Size, 0 to 1. */
  share: number;
  /** "78%"; "<1%" for a language present but under half a percent. */
  percent: string;
}

/** Each language's share of the Size, the largest first. */
export function languageShares(o: Overview): LanguageShare[] {
  const total = o.languages.reduce((sum, l) => sum + l.size, 0);
  if (total === 0) return [];
  return o.languages.map((l) => {
    const share = l.size / total;
    const rounded = Math.round(share * 100);
    const percent =
      rounded === 0 && l.size > 0
        ? "<1%"
        : rounded === 100 && share < 1
          ? ">99%"
          : `${rounded}%`;
    return {
      language: l.language,
      name: LANGUAGE_NAMES[l.language] ?? l.language,
      size: l.size,
      share,
      percent,
    };
  });
}

/**
 * Whether the panel starts open: as the viewer left it, else open on a wide
 * screen and folded on a narrow one, where it would cover the Map.
 */
export function overviewOpenAtStart(
  stored: string | null,
  wide: boolean,
): boolean {
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return wide;
}
