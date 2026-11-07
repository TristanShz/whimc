// Numbers and counts as the UI writes them.

import type { Summary } from "./api/types";

const counts = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return counts.format(n);
}

/**
 * A count short enough for a glance: exact below a thousand, then one
 * decimal in thousands or millions ("182.4k", "1.2M", "3k").
 */
export function formatCompact(n: number): string {
  const short = (v: number, unit: string) =>
    `${v.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (Math.abs(n) < 1000) return formatCount(n);
  if (Math.abs(n) < 999_950) return short(n / 1000, "k");
  return short(n / 1_000_000, "M");
}

/** "1 line", "1,240 lines". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/**
 * The one-line summary of a Comparison: Files changed, Files added,
 * Packages touched, then the Dependencies added and removed when any.
 */
export function changeSummary(s: Summary): string {
  if (s.filesChanged === 0) return "No File changed";
  const parts = [
    plural(s.filesChanged, "File changed", "Files changed"),
    `${formatCount(s.filesAdded)} added`,
    plural(s.packagesTouched, "Package touched", "Packages touched"),
  ];
  if (s.dependenciesAdded + s.dependenciesRemoved > 0)
    parts.push(
      `Dependencies +${formatCount(s.dependenciesAdded)} −${formatCount(s.dependenciesRemoved)}`,
    );
  return parts.join(" · ");
}

/**
 * Why a Comparison failed, in the UI's words: a ref that names nothing says
 * which one; anything else is shown as the server said it.
 */
export function compareFailure(message: string): string {
  const ref = /unknown ref "([^"]*)"/.exec(message)?.[1];
  if (ref !== undefined)
    return `No commit, branch or tag is named “${ref}”. Pick one from the list, or type “worktree” for the working tree.`;
  return `Could not compare: ${message}`;
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
