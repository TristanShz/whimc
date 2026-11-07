import { describe, expect, it } from "vitest";
import { typography } from "./typography";

describe("the typography of labels", () => {
  it("sets each level in its own voice", () => {
    const pkg = typography(0, 60, true);
    const dir = typography(1, 60, false);
    const file = typography(2, 60, false);
    expect(pkg.css).toContain("Geist Variable");
    expect(dir.css).toContain("Geist Variable");
    expect(file.css).toContain("Geist Mono");
    expect(pkg.size).toBeGreaterThan(dir.size);
    expect(dir.size).toBeGreaterThan(file.size);
    expect([pkg.tone, dir.tone, file.tone]).toEqual([
      "label",
      "label",
      "quiet",
    ]);
  });

  it("grows a Package name with its disc, within bounds", () => {
    expect(typography(0, 10, true).size).toBe(13);
    expect(typography(0, 2000, true).size).toBe(22);
    expect(typography(0, 100, true).size).toBeGreaterThan(
      typography(0, 20, true).size,
    );
  });

  it("spaces out a Package name, muted, once it only names a territory", () => {
    const t = typography(0, 400, false);
    expect(t.tone).toBe("muted");
    expect(t.tracking).toBeGreaterThan(0);
    expect(t.size).toBeGreaterThanOrEqual(13);
  });
});
