// The click details of a Module: name, path, Size, Churn, children and the
// children that move the most.

import { useEffect, useState } from "react";
import type { Api } from "../api/client";
import { failure } from "../data/useMapData";
import type { Module, ModuleDetails } from "../api/types";
import { formatCount, plural } from "../format";
import { Icon } from "./icons";

const KIND = {
  packages: "Package",
  directories: "Directory",
  files: "File",
} as const;
const CHILDREN = {
  packages: ["Directory", "Directories"],
  directories: ["File", "Files"],
} as const;

export interface DetailsPanelProps {
  api: Api;
  id: string;
  tests: boolean;
  /** The revision of the index: a newer one fetches the details again. */
  revision: number;
  onClose(): void;
  /** A moving child was picked: select it and bring it into view. */
  onPick(m: Module): void;
}

type State =
  { id: string; details: ModuleDetails } | { id: string; error: string } | null;

export function DetailsPanel(p: DetailsPanelProps) {
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    p.api.module({ id: p.id, tests: p.tests }, ctrl.signal).then(
      (details) => setState({ id: p.id, details }),
      (e: unknown) => {
        if (!ctrl.signal.aborted) setState({ id: p.id, error: failure(e) });
      },
    );
    return () => ctrl.abort();
  }, [p.api, p.id, p.tests, p.revision]);

  const current = state?.id === p.id ? state : null;

  return (
    <aside
      className="panel details"
      aria-label="Module details"
      aria-busy={current === null}
    >
      <button
        className="ghost-button details-close"
        aria-label="Close the details"
        onClick={p.onClose}
      >
        <Icon name="close" />
      </button>
      {current === null ? (
        <div className="details-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : "error" in current ? (
        <p className="details-error" role="alert">
          Could not load this Module: {current.error}
        </p>
      ) : (
        <Details details={current.details} onPick={p.onPick} />
      )}
    </aside>
  );
}

function Details({
  details,
  onPick,
}: {
  details: ModuleDetails;
  onPick(m: Module): void;
}) {
  const m = details.module;
  const children = m.level === "files" ? null : CHILDREN[m.level];
  const top = details.movingChildren;
  const maxChurn = Math.max(1, ...top.map((c) => c.churn));
  return (
    <>
      <p className="details-kind">
        {KIND[m.level]}
        {m.test ? ", test File" : ""}
      </p>
      <h2 className="details-name">{m.name}</h2>
      {m.path !== m.name && <p className="details-path">{m.path}</p>}
      <dl className="details-stats">
        <div>
          <dt>Size</dt>
          <dd>
            {formatCount(m.size)} <span>{m.size === 1 ? "line" : "lines"}</span>
          </dd>
        </div>
        <div>
          <dt title="Commits in the last 90 days">Churn</dt>
          <dd>
            {formatCount(m.churn)}{" "}
            <span>{m.churn === 1 ? "commit" : "commits"}</span>
          </dd>
        </div>
        {children && (
          <div>
            <dt>Inside</dt>
            <dd>
              {formatCount(m.children)}{" "}
              <span>{m.children === 1 ? children[0] : children[1]}</span>
            </dd>
          </div>
        )}
      </dl>
      {children && (
        <section className="details-moving">
          <h3>Moving the most</h3>
          {top.length === 0 ? (
            <p className="details-calm">
              Nothing inside moved in the last 90 days.
            </p>
          ) : (
            <ol>
              {top.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onPick(c)}
                    title={`Show ${c.path} on the Map`}
                  >
                    <span className="moving-name">
                      {c.path.startsWith(`${m.path}/`)
                        ? c.path.slice(m.path.length + 1)
                        : c.path}
                    </span>
                    <span className="moving-bar" aria-hidden="true">
                      <i style={{ width: `${(c.churn / maxChurn) * 100}%` }} />
                    </span>
                    <span className="moving-count">
                      {plural(c.churn, "commit")}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}
