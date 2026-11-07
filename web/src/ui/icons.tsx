// The few icons the Map's controls use, drawn on a 16-unit grid.

const paths = {
  plus: "M8 3.5v9M3.5 8h9",
  minus: "M3.5 8h9",
  fit: "M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14",
  close: "M4 4l8 8M12 4l-8 8",
  system: "M2.5 3.5h11v7h-11zM6 13.5h4M8 10.5v3",
  dark: "M13 9.6A5.5 5.5 0 0 1 6.4 3 5.5 5.5 0 1 0 13 9.6z",
  light:
    "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1",
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
