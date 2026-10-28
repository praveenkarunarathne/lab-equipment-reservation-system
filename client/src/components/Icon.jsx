const paths = {
  lab: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.75 3h10.5A2 2 0 0 0 19 18l-5-9V3M8 15h8',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  equipment: 'M4 4h16v12H4zM8 20h8M12 16v4M7 8h4M7 11h7',
  calendar:
    'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4M17 3v4M3 11h18M7 15h3M14 15h3',
  tool: 'm14 6 4 4M3 21l7-7M14 3a6 6 0 0 0-5 9l-7 7 3 3 7-7a6 6 0 0 0 9-5l-4 3-4-4 3-4Z',
  report: 'M12 8v5M12 17h.01M10 3h4l8 17H2L10 3Z',
  logout: 'M9 4H4v16h5M14 8l4 4-4 4M8 12h12',
  menu: 'M4 6h16M4 12h16M4 18h16',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};
export default function Icon({ name, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name] ?? paths.equipment} />
    </svg>
  );
}
