const paths = {
  hosts: 'M4 3h16v7H4z M4 14h16v7H4z M7 6.5h.01 M7 17.5h.01 M11 6.5h6 M11 17.5h6',
  terminal: 'm5 6 5 6-5 6 M13 18h6',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12 M18 6 6 18',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
  unlock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 7.5-1.9',
  plus: 'M12 5v14 M5 12h14',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  file: 'M6 3h8l4 4v14H6z M14 3v5h4',
  edit: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  chevron: 'm9 6 6 6-6 6',
  history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',
  rocket:
    'M14 5c3-2 6-2 6-2s0 3-2 6l-6 6-5-5 7-5z M7 10l-4 1 4 3 M12 15l1 5 3-5 M6 16l-3 5 5-3 M15 7h.01',
  palette:
    'M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.7-9-7.7z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01',
  panel: 'M4 4h16v16H4z M15 4v16',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  'eye-off':
    'M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2 M3 3l18 18',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
