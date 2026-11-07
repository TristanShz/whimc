import { describe, expect, it } from "vitest";
import { formatCount, measures, plural, shorten } from "./format";

describe("format", () => {
  it("groups thousands", () => {
    expect(formatCount(1240)).toBe("1,240");
  });

  it("agrees a count with its noun", () => {
    expect(plural(1, "commit")).toBe("1 commit");
    expect(plural(0, "commit")).toBe("0 commits");
    expect(plural(2, "Directory", "Directories")).toBe("2 Directories");
  });

  it("sums up a Module's Size and Churn", () => {
    expect(measures(1240, 1)).toBe("1,240 lines, 1 commit");
  });

  it("keeps the end of a long label", () => {
    expect(shorten("short")).toBe("short");
    const s = shorten("internal/server/handlers/very/deep/folder/name", 20);
    expect(s).toHaveLength(20);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("folder/name")).toBe(true);
  });
});
