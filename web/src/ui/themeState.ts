// The theme the viewer picked: the system's by default, or dark or light
// forced, remembered per viewer in browser storage. The choice is written on
// the root element as `data-theme`, which the CSS tokens follow.

export type ThemeChoice = "system" | "dark" | "light";

/** The localStorage key holding "dark" or "light"; absent for the system. */
export const THEME_KEY = "whimc.theme";

const ORDER: readonly ThemeChoice[] = ["system", "dark", "light"];

/** The choice stored, the system's for anything else. */
export function parseTheme(stored: string | null): ThemeChoice {
  return stored === "dark" || stored === "light" ? stored : "system";
}

/** The choice the theme button moves to: system, dark, light, system… */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
}

/** The value of `data-theme` for a choice; null to follow the system. */
export function themeAttribute(choice: ThemeChoice): "dark" | "light" | null {
  return choice === "system" ? null : choice;
}

/** What the theme button says it does. */
export function themeLabel(choice: ThemeChoice): string {
  const now =
    choice === "system" ? "follows the system" : `${choice}, chosen here`;
  const next = nextTheme(choice);
  return `Theme: ${now}. Switch to ${next === "system" ? "the system's" : next}`;
}
