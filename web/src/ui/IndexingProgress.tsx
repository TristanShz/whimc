// The first run filling the Map in: Dependencies and Churn arrive Package by
// Package after the structure, which is already on screen.

import { indexingShare, type Indexing } from "../data/live";
import { formatCount } from "../format";

export function IndexingProgress({ indexing }: { indexing: Indexing }) {
  if (indexing.phase === "done") return null;
  const share = indexingShare(indexing);
  const text =
    indexing.phase === "starting"
      ? "Reading the structure…"
      : `Dependencies and Churn: ${formatCount(indexing.done)} of ${formatCount(indexing.total)} Packages`;
  return (
    <div className="panel indexing" role="status">
      <span className="indexing-title">Indexing</span>
      <span className="indexing-text">{text}</span>
      <span
        className="indexing-bar"
        role="progressbar"
        aria-label="Packages indexed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <i style={{ transform: `scaleX(${share})` }} />
      </span>
    </div>
  );
}
