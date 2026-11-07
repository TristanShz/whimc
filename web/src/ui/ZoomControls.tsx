import { Icon } from "./icons";

export function ZoomControls(p: {
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
}) {
  return (
    <div className="panel zoom" role="group" aria-label="Zoom">
      <button onClick={p.onZoomIn} aria-label="Zoom in" title="Zoom in (+)">
        <Icon name="plus" />
      </button>
      <button onClick={p.onZoomOut} aria-label="Zoom out" title="Zoom out (−)">
        <Icon name="minus" />
      </button>
      <button
        onClick={p.onFit}
        aria-label="Fit the whole Map"
        title="Fit the whole Map (0)"
      >
        <Icon name="fit" />
      </button>
    </div>
  );
}
