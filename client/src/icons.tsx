interface IcoProps {
  readonly d: React.ReactNode;
  readonly size?: number;
  readonly sw?: number;
}

function Ico({ d, size = 14, sw = 1.6 }: IcoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d}
    </svg>
  );
}

export const Icons = {
  search: (
    <Ico
      d={
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </>
      }
    />
  ),
  searchLg: (
    <Ico
      d={
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </>
      }
      size={18}
    />
  ),
  menu: (
    <Ico
      d={
        <>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </>
      }
    />
  ),
  star: (
    <Ico d={<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z" />} />
  ),
  starFilled: (
    <Ico
      d={
        <path
          d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z"
          fill="currentColor"
        />
      }
    />
  ),
  pin: (
    <Ico
      d={
        <>
          <path d="M9 4h6l-1 7 3 3H7l3-3z" />
          <path d="M12 14v6" />
        </>
      }
    />
  ),
  pinFilled: (
    <Ico
      d={
        <>
          <path d="M9 4h6l-1 7 3 3H7l3-3z" fill="currentColor" />
          <path d="M12 14v6" />
        </>
      }
    />
  ),
  chart: (
    <Ico
      d={
        <>
          <path d="M4 4v16h16" />
          <path d="M8 16v-5" />
          <path d="M12 16V8" />
          <path d="M16 16v-3" />
        </>
      }
    />
  ),
  spark: (
    <Ico
      d={
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2" />
      }
    />
  ),
  chat: (
    <Ico
      d={
        <>
          <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-1-2V6a2 2 0 0 1 2-2Z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </>
      }
    />
  ),
  folder: (
    <Ico
      d={<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />}
    />
  ),
  download: (
    <Ico
      d={
        <>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </>
      }
    />
  ),
  plug: (
    <Ico
      d={
        <>
          <path d="M9 2v6" />
          <path d="M15 2v6" />
          <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
          <path d="M12 17v5" />
        </>
      }
    />
  ),
  settings: (
    <Ico
      d={
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </>
      }
    />
  ),
  plus: (
    <Ico
      d={
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      }
    />
  ),
  ghost: (
    <Ico
      d={
        <>
          <path d="M6 19V10a6 6 0 0 1 12 0v9l-3-2-3 2-3-2-3 2Z" />
          <path d="M9.25 10.5h.01" />
          <path d="M14.75 10.5h.01" />
        </>
      }
    />
  ),
  trash: (
    <Ico
      d={
        <>
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </>
      }
    />
  ),
  copy: (
    <Ico
      d={
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      }
    />
  ),
  arrowRight: (
    <Ico
      d={
        <>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </>
      }
    />
  ),
  arrowLeft: (
    <Ico
      d={
        <>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </>
      }
    />
  ),
  zap: <Ico d={<path d="M13 2 3 14h9l-1 8 10-12h-9z" />} />,
  sort: (
    <Ico
      d={
        <>
          <path d="M3 6h18" />
          <path d="M6 12h12" />
          <path d="M10 18h4" />
        </>
      }
    />
  ),
  check: <Ico d={<path d="m5 12 5 5 9-12" />} />,
  close: (
    <Ico
      d={
        <>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </>
      }
    />
  ),
  warn: (
    <Ico
      d={
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h0" />
        </>
      }
    />
  ),
  info: (
    <Ico
      d={
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4" />
          <path d="M12 8h0" />
        </>
      }
    />
  ),
  refresh: (
    <Ico
      d={
        <>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </>
      }
    />
  ),
  scope: (
    <Ico
      d={
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18" />
          <path d="M3 12h18" />
        </>
      }
    />
  ),
  database: (
    <Ico
      d={
        <>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </>
      }
    />
  ),
  sun: (
    <Ico
      d={
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      }
    />
  ),
  moon: <Ico d={<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />} />,
} as const;
