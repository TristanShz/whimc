import { describe, expect, it } from "vitest";
import type { Summary } from "./api/types";
import {
  changeSummary,
  compareFailure,
  formatCount,
  measures,
  plural,
  shorten,
} from "./format";

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

  describe("the summary of a Comparison", () => {
    const summary: Summary = {
      filesChanged: 14,
      filesAdded: 3,
      filesModified: 10,
      filesRemoved: 1,
      packagesTouched: 1,
      dependenciesAdded: 0,
      dependenciesRemoved: 0,
    };

    it("says Files changed, Files added and Packages touched in one line", () => {
      expect(changeSummary(summary)).toBe(
        "14 Files changed · 3 added · 1 Package touched",
      );
    });

    it("adds the Dependencies added and removed when there are any", () => {
      expect(
        changeSummary({
          ...summary,
          dependenciesAdded: 4,
          dependenciesRemoved: 1,
        }),
      ).toBe(
        "14 Files changed · 3 added · 1 Package touched · Dependencies +4 −1",
      );
    });

    it("says so when nothing changed", () => {
      expect(
        changeSummary({ ...summary, filesChanged: 0, packagesTouched: 0 }),
      ).toBe("No File changed");
    });
  });

  it("names the ref that names nothing when a Comparison fails", () => {
    expect(
      compareFailure(
        'compare: target nope: unknown ref "nope": not a commit, branch or tag of /repo',
      ),
    ).toBe(
      "No commit, branch or tag is named “nope”. Pick one from the list, or type “worktree” for the working tree.",
    );
    expect(compareFailure("whimc serve did not answer")).toBe(
      "Could not compare: whimc serve did not answer",
    );
  });
});
