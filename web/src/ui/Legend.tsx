// What size, colour and edge style mean, so the Map reads without docs.

import { useState, type CSSProperties } from "react";
import { churnRanges } from "../render/scales";
import { LEGEND_KEY, churnLegend, legendAtStart } from "./legendState";
import { readStored, writeStored } from "./storage";

const wide = () =>
  typeof window === "undefined" ||
  window.matchMedia("(min-width: 720px)").matches;

const stored = () => readStored(LEGEND_KEY);
const store = (value: "open" | "closed") => writeStored(LEGEND_KEY, value);

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

/** A Dependency as the Map draws it: a thin line, in its kind's pattern. */
function Line({
  dash,
  width = 1.25,
  taper = false,
  className,
}: {
  dash?: "dash" | "dot";
  width?: number;
  taper?: boolean;
  className?: string;
}) {
  return (
    <svg
      width="28"
      height="10"
      viewBox="0 0 28 10"
      aria-hidden="true"
      className={`legend-line${className ? ` ${className}` : ""}`}
    >
      {taper ? (
        <path d="M1 3.6 L27 4.6 L27 5.4 L1 6.4 Z" fill="currentColor" />
      ) : (
        <path
          d="M1 5 L27 5"
          fill="none"
          stroke="currentColor"
          strokeWidth={width}
          strokeDasharray={
            dash === "dash" ? "4 3" : dash === "dot" ? "1.25 3" : undefined
          }
        />
      )}
    </svg>
  );
}

/** A disc as the Map draws it, with the ring of a mark when it has one. */
function Disc({ className }: { className: string }) {
  return <span className={`legend-disc ${className}`} aria-hidden="true" />;
}

export interface LegendProps {
  /** Whether the Changes switch is on: its marks are explained. */
  changes?: boolean;
  /** The level in view, whose Churn steps the Legend tells. */
  levelName: string;
  /** The Churn of the busiest Module of that level. */
  churnMax: number;
}

export function Legend({ changes = false, levelName, churnMax }: LegendProps) {
  const [open, setOpen] = useLegendOpen();
  const steps = churnLegend(churnRanges(churnMax));
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
          <dt>Size</dt>
          <dd className="legend-inline">
            <span className="legend-sizes" aria-hidden="true">
              <i style={{ width: 6, height: 6 }} />
              <i style={{ width: 10, height: 10 }} />
              <i style={{ width: 16, height: 16 }} />
            </span>
            lines of code
          </dd>
        </div>
        <div className="legend-row">
          <dt>Churn</dt>
          <dd>
            <span className="legend-note">
              {levelName} by commits in the last 90 days
            </span>
            <ol className="legend-churn">
              {steps.map((range, i) => (
                <li key={i} className={range === "none" ? "is-empty" : ""}>
                  <span
                    className="legend-swatch"
                    style={
                      { "--swatch": `var(--churn-${i + 1})` } as CSSProperties
                    }
                    aria-hidden="true"
                  />
                  <span className="visually-hidden">
                    {i === 0
                      ? "Calmest step: "
                      : i === steps.length - 1
                        ? "Busiest step: "
                        : `Step ${i + 1}: `}
                  </span>
                  {range}
                </li>
              ))}
            </ol>
          </dd>
        </div>
        <div className="legend-row">
          <dt>Dependencies</dt>
          <dd className="legend-list">
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
              <Line width={0.75} />
              <Line width={2.25} /> more imports, thicker
            </span>
          </dd>
        </div>
        <div className="legend-row">
          <dt>Focus</dt>
          <dd className="legend-list">
            <span>
              <Disc className="legend-focused" /> hovered or selected, with its
              Dependencies
            </span>
            <span>
              <Line taper className="legend-focus-line" /> narrows towards the
              imported Module
            </span>
            <span>
              <Disc className="legend-match" /> search match
            </span>
          </dd>
        </div>
        {changes && (
          <div className="legend-row">
            <dt>Changes</dt>
            <dd className="legend-list">
              <span>
                <Disc className="legend-added" /> added
              </span>
              <span>
                <Disc className="legend-modified" /> modified
              </span>
              <span>
                <Disc className="legend-removed" /> removed
              </span>
              <span>
                <span className="legend-badge" aria-hidden="true">
                  3
                </span>
                changed Files inside
              </span>
              <span>
                <Line className="legend-added-line" /> Dependency added
              </span>
              <span>
                <Line className="legend-modified-line" /> Dependency modified
                (count or kind)
              </span>
              <span>
                <Line className="legend-removed-line" /> Dependency removed
              </span>
              <span className="legend-note">What did not change fades.</span>
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
