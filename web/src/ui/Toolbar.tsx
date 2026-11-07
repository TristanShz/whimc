import type { Ref } from "react";
import { plural } from "../format";
import { Icon } from "./icons";

export interface ToolbarProps {
  search: string;
  /** Modules matching the search among those loaded. */
  matches: number;
  tests: boolean;
  onSearch(q: string): void;
  /** Enter in the search field: bring the matches into view. */
  onSearchSubmit(): void;
  onTests(on: boolean): void;
  searchRef: Ref<HTMLInputElement>;
}

export function Toolbar(p: ToolbarProps) {
  const searching = p.search.trim() !== "";
  return (
    <header className="panel toolbar">
      <span className="brand">whimc</span>
      <div className="search">
        <Icon name="search" />
        <input
          ref={p.searchRef}
          type="search"
          value={p.search}
          placeholder="Search Modules"
          aria-label="Search Modules by name or path"
          aria-describedby="search-result"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => p.onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") p.onSearchSubmit();
          }}
        />
        {searching ? (
          <button
            className="ghost-button"
            aria-label="Clear the search"
            onClick={() => p.onSearch("")}
          >
            <Icon name="close" />
          </button>
        ) : (
          <kbd aria-hidden="true">/</kbd>
        )}
      </div>
      <span
        id="search-result"
        className={`search-result${searching ? "" : " visually-hidden"}`}
        aria-live="polite"
      >
        {searching
          ? p.matches > 0
            ? plural(p.matches, "match", "matches")
            : "No Module matches"
          : ""}
      </span>
      <button
        className="switch"
        aria-pressed={p.tests}
        onClick={() => p.onTests(!p.tests)}
      >
        <span className="switch-track" aria-hidden="true" />
        Test Files
      </button>
    </header>
  );
}
