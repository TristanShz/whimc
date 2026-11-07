// Numbers and counts as the UI writes them.

const counts = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return counts.format(n);
}

/** "1 line", "1,240 lines". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** The one-line summary of a Module: its Size and its Churn. */
export function measures(size: number, churn: number): string {
  return `${plural(size, "line")}, ${plural(churn, "commit")}`;
}

/**
 * A label short enough to sit under a node: long paths keep their end, which
 * names the thing, behind an ellipsis.
 */
export function shorten(label: string, max = 32): string {
  if (label.length <= max) return label;
  return `…${label.slice(label.length - max + 1)}`;
}
