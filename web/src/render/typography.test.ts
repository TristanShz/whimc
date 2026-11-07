import { describe, expect, it } from "vitest";
import { typography } from "./typography";

describe("the typography of labels", () => {
  it("sets every level in Inter, the hierarchy in weight and tone", () => {
    const pkg = typography(0, 60, true);
    const dir = typography(1, 60, false);
    const file = typography(2, 60, false);
    for (const t of [pkg, dir, file]) expect(t.css).toContain("Inter Variable");
    expect(dir.css).toMatch(/^500 12px/);
    expect(pkg.size).toBeGreaterThanOrEqual(dir.size);
    expect(file.size).toBe(dir.size);
    expect(file.css).toMatch(/^450 /);
    expect([pkg.tone, dir.tone, file.tone]).toEqual([
      "label",
      "label",
      "quiet",
    ]);
  });

  it("lets a large Package disc take a slightly larger name, no more", () => {
    expect(typography(0, 10, true).size).toBe(13);
    expect(typography(0, 2000, true).size).toBe(14);
  });

  it("mutes a Package name once it only names a territory", () => {
    const t = typography(0, 400, false);
    expect(t.tone).toBe("muted");
    expect(t.tracking).toBe(0);
  });
});
