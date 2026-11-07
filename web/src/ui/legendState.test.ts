import { describe, expect, it } from "vitest";
import { legendAtStart } from "./legendState";

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
