// The Overview of the State in view: a few figures to read at a glance —
// Size, the counts of Modules and Dependencies, the commits of the Churn
// window, the language split and the Package moving the most.

import { useEffect, useState, type CSSProperties } from "react";
import type { Api } from "../api/client";
import type { Overview } from "../api/types";
import { failure } from "../data/useMapData";
import { formatCompact, plural } from "../format";
import {
  OVERVIEW_KEY,
  languageShares,
  overviewOpenAtStart,
} from "./overviewState";
import { readStored, writeStored } from "./storage";

export interface OverviewPanelProps {
  api: Api;
  /** The State in view: a ref, or null for the working tree. */
  stateRef: string | null;
  tests: boolean;
  /** The revision of the index: a newer one fetches the Overview again. */
  revision: number;
}

const wide = () =>
  typeof window === "undefined" ||
  window.matchMedia("(min-width: 720px)").matches;

export function OverviewPanel(p: OverviewPanelProps) {
  const [open, setOpen] = useState(() =>
    overviewOpenAtStart(readStored(OVERVIEW_KEY), wide()),
  );
  // The last Overview stays on screen while a newer one is fetched; one
  // of another State or tests switch is only shown faded, as a placeholder.
  const key = `${p.stateRef ?? ""}|${p.tests}`;
  const [shown, setShown] = useState<{ key: string; overview: Overview }>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    p.api
      .overview(
        { ...(p.stateRef ? { ref: p.stateRef } : {}), tests: p.tests },
        ctrl.signal,
      )
      .then(
        (overview) => {
          setShown({ key, overview });
          setError(undefined);
        },
        (e: unknown) => {
          if (!ctrl.signal.aborted) setError({ key, message: failure(e) });
        },
      );
    return () => ctrl.abort();
  }, [p.api, p.stateRef, p.tests, p.revision, attempt, key]);

  const toggle = () => {
    setOpen(!open);
    writeStored(OVERVIEW_KEY, open ? "closed" : "open");
  };

  const current = shown?.key === key ? shown.overview : undefined;
  const failed = error?.key === key ? error.message : undefined;
  const placeholder = !current && !failed ? shown?.overview : undefined;
  const overview = current ?? placeholder;

  return (
    <section
      className="panel overview"
      aria-label="Overview of the repository"
      aria-busy={!current && !failed}
    >
      <button
        className="overview-head"
        aria-expanded={open}
        aria-controls="overview-body"
        onClick={toggle}
      >
        Overview
        {!open && overview && (
          <span
            className="overview-head-size"
            title={plural(overview.size, "line")}
          >
            {formatCompact(overview.size)} lines
          </span>
        )}
      </button>
      <div
        id="overview-body"
        hidden={!open}
        className={placeholder ? "is-stale" : undefined}
      >
        {overview ? (
          <Figures overview={overview} />
        ) : !failed ? (
          <div className="overview-skeleton" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : null}
        {failed !== undefined && (
          <p className="overview-error" role="alert">
            {current ? "Could not refresh" : "Could not load the Overview"}:{" "}
            {failed}.{" "}
            <button onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </p>
        )}
      </div>
    </section>
  );
}

function Figures({ overview: o }: { overview: Overview }) {
  const counting = o.partial
    ? " (still counting, the first run is under way)"
    : "";
  const figures: {
    label: string;
    value: number;
    title: string;
    partial?: boolean;
  }[] = [
    {
      label: "Lines",
      value: o.size,
      title: `${plural(o.size, "line")} of code, blank lines left out`,
    },
    { label: "Files", value: o.files, title: plural(o.files, "File") },
    {
      label: "Directories",
      value: o.directories,
      title: plural(o.directories, "Directory", "Directories"),
    },
    {
      label: "Packages",
      value: o.packages,
      title: plural(o.packages, "Package"),
    },
    {
      label: "Dependencies",
      value: o.dependencies,
      title: `${plural(o.dependencies, "Dependency", "Dependencies")} between Files${counting}`,
      partial: o.partial,
    },
    {
      label: "Commits",
      value: o.commits,
      title: `${plural(o.commits, "commit")} touched a File in the last 90 days${counting}`,
      partial: o.partial,
    },
  ];
  const shares = languageShares(o);
  return (
    <>
      <dl className="overview-figures">
        {figures.map((f) => (
          <div key={f.label} className={f.partial ? "is-partial" : undefined}>
            <dt>{f.label}</dt>
            <dd title={f.title}>
              {formatCompact(f.value)}
              <span className="visually-hidden">, {f.title}</span>
            </dd>
          </div>
        ))}
      </dl>
      {shares.length > 0 && (
        <div className="overview-languages">
          <span className="overview-bar" aria-hidden="true">
            {shares.map((s) => (
              <i
                key={s.language}
                className={`lang-${s.language}`}
                style={{ flexGrow: s.share } as CSSProperties}
              />
            ))}
          </span>
          <ul aria-label="Lines by language">
            {shares.map((s) => (
              <li key={s.language}>
                <span
                  className={`overview-swatch lang-${s.language}`}
                  aria-hidden="true"
                />
                {s.name}
                <span
                  className="overview-percent"
                  title={plural(s.size, "line")}
                >
                  {s.percent}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {o.movingPackage && (
        <p className="overview-moving">
          <span>Moving the most</span>
          <strong title={o.movingPackage.id.replace(/^pkg:/, "")}>
            {o.movingPackage.name}
          </strong>
          <span className="overview-moving-count">
            {plural(o.movingPackage.churn, "commit")}
          </span>
        </p>
      )}
    </>
  );
}
