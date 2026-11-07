// What size, colour and edge style mean, so the Map reads without docs.

const wide = () =>
  typeof window === "undefined" ||
  window.matchMedia("(min-width: 720px)").matches;

function Line({ dash }: { dash?: string }) {
  return (
    <svg width="34" height="8" viewBox="0 0 34 8" aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2="33"
        y2="4"
        stroke="currentColor"
        strokeWidth={dash === "dot" ? 2.4 : 1.6}
        strokeLinecap="round"
        strokeDasharray={
          dash === "dash" ? "5 3.5" : dash === "dot" ? "0.1 5" : undefined
        }
      />
    </svg>
  );
}

/** A disc as the Changes switch marks it. */
function Mark({ kind }: { kind: "added" | "modified" | "removed" }) {
  return <span className={`legend-mark legend-${kind}`} aria-hidden="true" />;
}

export function Legend({ changes = false }: { changes?: boolean }) {
  return (
    <details className="panel legend" open={wide()}>
      <summary>Legend</summary>
      <dl>
        <div className="legend-row">
          <dt>
            <span className="legend-sizes" aria-hidden="true">
              <i style={{ width: 6, height: 6 }} />
              <i style={{ width: 10, height: 10 }} />
              <i style={{ width: 16, height: 16 }} />
            </span>
          </dt>
          <dd>Size, in lines of code</dd>
        </div>
        <div className="legend-row">
          <dt>
            <span className="legend-ramp" aria-hidden="true" />
          </dt>
          <dd>
            Churn, commits in the last 90 days
            <span className="legend-ends">
              <span>calm</span>
              <span>moving a lot</span>
            </span>
          </dd>
        </div>
        <div className="legend-row legend-edges">
          <dt className="visually-hidden">Dependencies</dt>
          <dd>
            <span>
              <Line /> runtime
            </span>
            <span>
              <Line dash="dash" /> type-only
            </span>
            <span>
              <Line dash="dot" /> dynamic
            </span>
          </dd>
        </div>
        {changes && (
          <div className="legend-row legend-changes">
            <dt className="visually-hidden">Changes</dt>
            <dd>
              <span>
                <Mark kind="added" /> added
              </span>
              <span>
                <Mark kind="modified" /> modified
              </span>
              <span>
                <Mark kind="removed" /> removed
              </span>
              <span>
                <span className="legend-badge" aria-hidden="true">
                  3
                </span>{" "}
                changed Files inside
              </span>
              <span className="legend-deps">
                Dependencies: <b className="legend-added-text">added</b>,{" "}
                <b className="legend-removed-text">removed</b>; the rest fades
              </span>
            </dd>
          </div>
        )}
      </dl>
      <p className="legend-hint">
        Scroll or pinch to zoom, drag to pan, click a Module for details. Keys:{" "}
        <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> <kbd>/</kbd>
      </p>
    </details>
  );
}
