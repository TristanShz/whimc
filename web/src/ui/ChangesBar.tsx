// The Changes switch's bar: which two States the Map compares, and the size
// of the change in one line.

import { useEffect, useId, useState } from "react";
import type { Api } from "../api/client";
import type { Refs } from "../api/types";
import { changeSummary, compareFailure } from "../format";
import type { ChangesRefs, ViewState } from "../viewState";

/** The ref naming the working tree in the API. */
export const WORKTREE = "worktree";
export const DEFAULT_REFS: ChangesRefs = { base: "HEAD", target: WORKTREE };

export interface ChangesBarProps {
  api: Api;
  refs: ChangesRefs;
  onRefs(r: ChangesRefs): void;
  changes: ViewState["changes"];
  /** The Comparison is on its way. */
  loading: boolean;
  /** Why the last Comparison failed, until one loads. */
  error?: string | undefined;
  /** Moves on when the index changed: the refs are listed again. */
  revision: number;
}

export function ChangesBar(p: ChangesBarProps) {
  const listId = useId();
  const [refs, setRefs] = useState<Refs | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    p.api.refs(ctrl.signal).then(setRefs, () => {
      // Without the list, any ref can still be typed.
    });
    return () => ctrl.abort();
  }, [p.api, p.revision]);

  const summary = p.error
    ? null
    : p.changes?.current
      ? changeSummary(p.changes.summary)
      : null;

  return (
    <section id="changes-bar" className="panel changes" aria-label="Changes">
      <div className="changes-refs">
        <RefField
          label="Base"
          value={p.refs.base}
          fallback={DEFAULT_REFS.base}
          list={listId}
          onCommit={(base) => p.onRefs({ ...p.refs, base })}
        />
        <span className="changes-arrow" aria-hidden="true">
          →
        </span>
        <RefField
          label="Target"
          value={p.refs.target}
          fallback={DEFAULT_REFS.target}
          list={listId}
          onCommit={(target) => p.onRefs({ ...p.refs, target })}
        />
      </div>
      <datalist id={listId}>
        <option value={WORKTREE}>
          Working tree, uncommitted edits included
        </option>
        <option value="HEAD">
          {refs?.head ? `HEAD, on ${refs.head}` : "HEAD"}
        </option>
        {refs?.branches.map((r) => (
          <option key={`b:${r.name}`} value={r.name}>
            Branch · {r.subject}
          </option>
        ))}
        {refs?.tags.map((r) => (
          <option key={`t:${r.name}`} value={r.name}>
            Tag · {r.subject}
          </option>
        ))}
        {refs?.commits.map((r) => (
          <option key={`c:${r.commit}`} value={r.name}>
            {r.subject}
          </option>
        ))}
      </datalist>
      <p
        className={`changes-summary${p.error ? " changes-error" : ""}`}
        role={p.error ? "alert" : "status"}
      >
        {p.error
          ? compareFailure(p.error)
          : (summary ?? (p.loading ? "Comparing…" : ""))}
      </p>
    </section>
  );
}

/**
 * A ref, typed or picked among the branches, tags and recent commits; it
 * applies on Enter or when leaving the field, Esc puts the applied one back,
 * and an empty field takes the default.
 */
function RefField(p: {
  label: string;
  value: string;
  fallback: string;
  list: string;
  onCommit(ref: string): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(p.value);
  useEffect(() => setDraft(p.value), [p.value]);
  const commit = () => {
    const ref = draft.trim() || p.fallback;
    setDraft(ref);
    if (ref !== p.value) p.onCommit(ref);
  };
  return (
    <span className="ref-field">
      <label htmlFor={id}>{p.label}</label>
      <input
        id={id}
        list={p.list}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(p.value);
            e.stopPropagation();
          }
        }}
      />
    </span>
  );
}
