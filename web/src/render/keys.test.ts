import { describe, expect, it } from "vitest";
import { keyAction } from "./keys";

const press = (
  key: string,
  extra: Partial<Parameters<typeof keyAction>[0]> = {},
) =>
  keyAction(
    { key, ctrlKey: false, metaKey: false, altKey: false, ...extra },
    false,
  );

describe("keyboard", () => {
  it("zooms with + and -, and fits with 0", () => {
    expect(press("+")).toBe("zoomIn");
    expect(press("=")).toBe("zoomIn");
    expect(press("-")).toBe("zoomOut");
    expect(press("_")).toBe("zoomOut");
    expect(press("0")).toBe("fit");
  });

  it("focuses the search with / and clears the focus with Escape", () => {
    expect(press("/")).toBe("search");
    expect(press("Escape")).toBe("escape");
  });

  it("leaves the browser's own shortcuts alone", () => {
    expect(press("+", { metaKey: true })).toBeNull();
    expect(press("-", { ctrlKey: true })).toBeNull();
    expect(press("0", { altKey: true })).toBeNull();
    expect(press("a")).toBeNull();
  });

  it("lets a text field keep every key but Escape", () => {
    const typing = (key: string) =>
      keyAction({ key, ctrlKey: false, metaKey: false, altKey: false }, true);
    expect(typing("+")).toBeNull();
    expect(typing("0")).toBeNull();
    expect(typing("/")).toBeNull();
    expect(typing("Escape")).toBe("escape");
  });
});
