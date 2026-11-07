// What size, colour and edge style mean, so the Map reads without docs.

import { useState } from "react";
import { LEGEND_KEY, legendAtStart } from "./legendState";

const wide = () =>
  typeof window === "undefined" ||
  window.matchMedia("(min-width: 720px)").matches;

/** Browser storage may be off: the Legend then opens as on a first view. */
function stored(): string | null {
  try {
    return window.localStorage.getItem(LEGEND_KEY);
  } catch {
    return null;
  }
}

function store(value: "open" | "closed") {
  try {
    window.localStorage.setItem(LEGEND_KEY, value);
  } catch {
    // Not remembered: the next view opens as this one did.
  }
}

function useLegendOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    const start = legendAtStart(stored(), wide());
    if (start.store) store(start.store);
    return start.open;
  });
  return [
    open,
    (next: boolean) => {
      setOpen(next);
      store(next ? "open" : "closed");
    },
  ];
}

/** A Dependency as the Map draws it: a gentle arc, in its kind's pattern. */
function Line({ dash, className }: { dash?: string; className?: string }) {
  return (
    <svg
      width="34"
      height="10"
      viewBox="0 0 34 10"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M1 7 Q17 1 33 7"
        fill="none"
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

/** The taper of a Dependency: wide at the importer, narrow at the imported. */
function Taper() {
  return (
    <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true">
      <circle cx="3" cy="7" r="2.5" fill="currentColor" opacity="0.55" />
      <path
        d="M6 5.4 Q18 1.2 30 6.4 L30 7 Q18 3.4 6 8.6 Z"
        fill="currentColor"
      />
      <circle cx="31.5" cy="6.7" r="1.6" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

/** A disc as the Changes switch marks it. */
function Mark({ kind }: { kind: "added" | "modified" | "removed" }) {
  return <span className={`legend-mark legend-${kind}`} aria-hidden="true" />;
}

export function Legend({ changes = false }: { changes?: boolean }) {
  const [open, setOpen] = useLegendOpen();
  return (
    <details className="panel legend" open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        Legend
      </summary>
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
            <span>
              <Taper /> wide at the importer, narrow at the imported
            </span>
          </dd>
        </div>
        <div className="legend-row legend-focus">
          <dt className="visually-hidden">Focus</dt>
          <dd>
            <span>
              <span className="legend-mark legend-focused" aria-hidden="true" />
              <Line className="legend-focus-line" /> hovered or selected Module,
              its Dependencies, search matches
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
              <span className="legend-deps">Dependencies:</span>
              <span>
                <Line className="legend-added-line" /> added
              </span>
              <span>
                <Line className="legend-modified-line" /> modified (count or
                kind)
              </span>
              <span>
                <Line className="legend-removed-line" /> removed
              </span>
              <span className="legend-deps">What did not change fades.</span>
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
