import type { CSSProperties } from "react";
import type { Level } from "../api/types";

const NAMES: Record<Level, string> = {
  packages: "Packages",
  directories: "Directories",
  files: "Files",
};

/**
 * Which level the nodes on screen are. The marker follows the zoom
 * continuously (depth 0 to 2), so it slides as the levels blend.
 */
export function LevelIndicator({
  level,
  depth,
}: {
  level: Level;
  depth: number;
}) {
  return (
    <nav className="panel levels" aria-label="Level of the Map">
      <span
        className="levels-marker"
        aria-hidden="true"
        style={{ "--depth": depth } as CSSProperties}
      />
      {(Object.keys(NAMES) as Level[]).map((l) => (
        <span
          key={l}
          className="levels-item"
          aria-current={l === level ? "true" : undefined}
        >
          {NAMES[l]}
        </span>
      ))}
      <span className="visually-hidden" aria-live="polite">
        Showing {NAMES[level]}
      </span>
    </nav>
  );
}
