import { describe, expect, it } from "vitest";
import {
  nextTheme,
  parseTheme,
  themeAttribute,
  themeLabel,
} from "./themeState";

describe("theme choice", () => {
  it("follows the system unless dark or light was chosen", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("nonsense")).toBe("system");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });

  it("cycles from the system to dark, light and back", () => {
    expect(nextTheme("system")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("system");
  });

  it("writes no data-theme for the system, so that the media query decides", () => {
    expect(themeAttribute("system")).toBeNull();
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("light")).toBe("light");
  });

  it("says what the button does next", () => {
    expect(themeLabel("system")).toBe(
      "Theme: follows the system. Switch to dark",
    );
    expect(themeLabel("light")).toBe(
      "Theme: light, chosen here. Switch to the system's",
    );
  });
});
