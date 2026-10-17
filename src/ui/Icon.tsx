// Line icons for the top bar, drawn in the same 1.5px ink stroke as the boards.

const PATHS = {
  replay: "M4 10a6 6 0 1 1 1.8 4.3M4 15v-4.5h4.5",
  download: "M10 3.5v9M6 9l4 4 4-4M4 16.5h12",
  upload: "M10 13V4M6 7.5l4-4 4 4M4 16.5h12",
  chart: "M4 16.5h12M6 14V9M10 14V5M14 14v-3",
  dice: "M4.5 4.5h11v11h-11zM7.5 7.5h.01M12.5 7.5h.01M10 10h.01M7.5 12.5h.01M12.5 12.5h.01",
  system: "M10 3.5a6.5 6.5 0 1 0 0 13zM10 3.5a6.5 6.5 0 1 1 0 13",
  sun: "M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1 1M14.3 14.3l1 1M4.7 15.3l1-1M14.3 5.7l1-1",
  moon: "M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8",
  models: "M10 3.5l6.5 3.25L10 10 3.5 6.75zM3.5 10.25L10 13.5l6.5-3.25M3.5 13.75L10 17l6.5-3.25",
  plus: "M10 4.5v11M4.5 10h11",
  close: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  edit: "M12.5 4.5l3 3-8 8h-3v-3zM10.5 6.5l3 3",
  trash: "M4.5 6h11M8 6V4.5h4V6M6 6l.75 9.5h6.5L14 6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} fill={name === "system" ? "none" : undefined} />
      {name === "system" && <path d="M10 3.5a6.5 6.5 0 1 0 0 13z" fill="currentColor" stroke="none" />}
    </svg>
  );
}
