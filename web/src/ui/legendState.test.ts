import { describe, expect, it } from "vitest";
import { churnLegend, legendAtStart } from "./legendState";

describe("the Legend at start", () => {
  it("opens on the first view of a wide screen, and starts collapsed after", () => {
    expect(legendAtStart(null, true)).toEqual({ open: true, store: "closed" });
    expect(legendAtStart(null, false)).toEqual({
      open: false,
      store: "closed",
    });
  });

  it("keeps what the user chose last", () => {
    expect(legendAtStart("open", false)).toEqual({ open: true, store: null });
    expect(legendAtStart("closed", true)).toEqual({ open: false, store: null });
  });
});

describe("the Churn steps in the Legend", () => {
  it("writes the commits each step covers", () => {
    expect(
      churnLegend([
        { from: 0, to: 0 },
        { from: 1, to: 2 },
        null,
        { from: 3, to: 9 },
        { from: 10, to: 1240 },
      ]),
    ).toEqual(["0", "1–2", "none", "3–9", "10–1,240"]);
  });
});
