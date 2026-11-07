// The Map's keyboard shortcuts.

export type KeyAction = "zoomIn" | "zoomOut" | "fit" | "search" | "escape";

export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * The action of a key press, or null to let the browser have it. `editable`
 * is true while a text field has the focus: it keeps its keys, Escape aside.
 */
export function keyAction(e: KeyPress, editable: boolean): KeyAction | null {
  if (e.key === "Escape") return "escape";
  if (editable || e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case "+":
    case "=":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    case "0":
      return "fit";
    case "/":
      return "search";
    default:
      return null;
  }
}
