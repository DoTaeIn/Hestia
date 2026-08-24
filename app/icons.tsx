/** Authored icon set. One grid (24), one stroke (1.25), round caps, no fills. */

type P = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const ArrowRight = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12h15" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

export const Lock = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);

export const Search = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

export const Ring = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

export const Page = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 3.5h8L18.5 8v12.5H6z" />
    <path d="M13.5 3.5V8.5h5" />
  </svg>
);

export const Caret = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const Bold = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 4.5h5.5a3.75 3.75 0 0 1 0 7.5H7z" />
    <path d="M7 12h6.5a3.75 3.75 0 0 1 0 7.5H7z" />
  </svg>
);

export const Italic = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 4.5h-5M14.5 19.5h-5M13.5 4.5 10.5 19.5" />
  </svg>
);

export const Heading = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5.5 5v14M14.5 5v14M5.5 12h9" />
    <path d="M17 19.5h2.5" />
  </svg>
);

export const Quote = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 18V9.5A2.5 2.5 0 0 1 7.5 7H9" />
    <path d="M14 18V9.5A2.5 2.5 0 0 1 16.5 7H18" />
  </svg>
);

export const ListIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
  </svg>
);

export const Code = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m8.5 8.5-4 3.5 4 3.5M15.5 8.5l4 3.5-4 3.5" />
  </svg>
);

export const Table = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="4" y="5" width="16" height="14" rx="1" />
    <path d="M4 10h16M4 14.5h16M10.5 5v14" />
  </svg>
);

export const ImageIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="4" y="5" width="16" height="14" rx="1" />
    <circle cx="9" cy="10" r="1.4" />
    <path d="m5 17 4.5-4.5L14 17M13 15.5l2.5-2.5L19 16.5" />
  </svg>
);

export const Upload = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 15V4.5M8 8.5 12 4.5l4 4" />
    <path d="M5 14.5v4.5h14v-4.5" />
  </svg>
);

export const Undo = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 9.5h9a5 5 0 0 1 0 10H9" />
    <path d="m8 5.5-3.5 4 3.5 4" />
  </svg>
);

export const Restore = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 6.5v6l4 2" />
    <path d="M4.6 10.2a7.6 7.6 0 1 1 .2 4.6" />
    <path d="M4.5 5.5v4.7h4.7" />
  </svg>
);

export const Sun = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

export const Moon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
  </svg>
);

export const Share = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
  </svg>
);

export const Check = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const Globe = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8" />
    <path d="M4 12h16M12 4a13 13 0 0 1 0 16 13 13 0 0 1 0-16Z" />
  </svg>
);

export const Comment = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 6.5h15v10h-8.5L7 20v-3.5H4.5z" />
  </svg>
);

export const Pencil = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 19.5h4L19 9a2.5 2.5 0 0 0-3.5-3.5L5 16z" />
    <path d="M14.5 6.5 18 10" />
  </svg>
);

export const Trash = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5.5 7.5h13M9.5 7.5v-3h5v3M7.5 7.5l.8 12h7.4l.8-12M10 11v5M14 11v5" />
  </svg>
);

export const Copy = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="8" y="8" width="11" height="11" rx="1" />
    <path d="M16 8V5H5v11h3" />
  </svg>
);

export const Bell = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.2.8 4.8 1.5 5.7H5c.7-.9 1.5-2.5 1.5-5.7Z" />
    <path d="M10 18.5a2 2 0 0 0 4 0" />
  </svg>
);

export const User = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="3.25" />
    <path d="M5.5 20c.7-3.3 3.1-5 6.5-5s5.8 1.7 6.5 5" />
  </svg>
);

export const LogOut = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M10.5 5H5v14h5.5" />
    <path d="M13 8.5 16.5 12 13 15.5M8.5 12h8" />
  </svg>
);

export const Grip = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="8" cy="6.5" r="0.75" fill="currentColor" />
    <circle cx="16" cy="6.5" r="0.75" fill="currentColor" />
    <circle cx="8" cy="12" r="0.75" fill="currentColor" />
    <circle cx="16" cy="12" r="0.75" fill="currentColor" />
    <circle cx="8" cy="17.5" r="0.75" fill="currentColor" />
    <circle cx="16" cy="17.5" r="0.75" fill="currentColor" />
  </svg>
);
