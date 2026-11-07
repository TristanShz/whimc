// The few icons the Map's controls use, drawn on a 16-unit grid.

const paths = {
  plus: "M8 3.5v9M3.5 8h9",
  minus: "M3.5 8h9",
  fit: "M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14",
  close: "M4 4l8 8M12 4l-8 8",
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
