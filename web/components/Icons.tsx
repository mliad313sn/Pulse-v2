// Hand-rolled inline SVG icons (no icon libraries).

interface IconProps {
  className?: string;
}

function base(className?: string) {
  return {
    className: className || "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
      <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3l7.5 3v5.2c0 4.6-3.1 8-7.5 9.8-4.4-1.8-7.5-5.2-7.5-9.8V6z" />
    </svg>
  );
}

export function ShieldCheckIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3l7.5 3v5.2c0 4.6-3.1 8-7.5 9.8-4.4-1.8-7.5-5.2-7.5-9.8V6z" />
      <path d="M9 12l2.2 2.2L15.5 9.7" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 4l9.5 16.5h-19z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 4v10m0 0l-4-4m4 4l4-4" />
      <path d="M4.5 17v2.5h15V17" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M9.5 6l6 6-6 6" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloudOffIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6.5 18.5h11a4 4 0 0 0 .8-7.9 6 6 0 0 0-10.7-2.5A4.5 4.5 0 0 0 6.5 18.5z" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function CloudIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6.5 18.5h11a4 4 0 0 0 .8-7.9 6 6 0 0 0-10.7-2.5A4.5 4.5 0 0 0 6.5 18.5z" />
    </svg>
  );
}

export function SyncIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M20 8a8 8 0 0 0-14.5-2M4 4v4h4" />
      <path d="M4 16a8 8 0 0 0 14.5 2M20 20v-4h-4" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.2A9.7 9.7 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17.6 17.6 0 0 1-3.2 3.7M6 7.2A16.7 16.7 0 0 0 2.5 12S6 18.2 12 18.2c1 0 2-.2 2.8-.5" />
      <path d="M9.6 9.7a2.8 2.8 0 0 0 4 4" />
    </svg>
  );
}

export function KeyIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="8" cy="15.5" r="3.8" />
      <path d="M10.8 12.7 19.5 4M15.5 8l3 3M13 10.5l2 2" />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M14.5 8V5.5h-9v13h9V16" />
      <path d="M9.5 12h11m0 0-3-3m3 3-3 3" />
    </svg>
  );
}

export function CogIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A7.6 7.6 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
    </svg>
  );
}

export function FlagIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5c2.2-1.4 4.4-1.4 6.5 0s4.3 1.4 6.5 0V13c-2.2 1.4-4.4 1.4-6.5 0s-4.3-1.4-6.5 0" />
    </svg>
  );
}

export function ScaleIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3.5v17M8 20.5h8" />
      <path d="M12 5.5L5.5 7.5M12 5.5l6.5 2" />
      <path d="M3 13.5l2.5-6 2.5 6a2.6 2.6 0 0 1-5 0z" />
      <path d="M16 13.5l2.5-6 2.5 6a2.6 2.6 0 0 1-5 0z" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4.5 19.5l.9-3.6L16.8 4.5a2.05 2.05 0 0 1 2.9 2.9L8.3 18.8l-3.8.7z" />
      <path d="M14.6 6.7l2.9 2.9" />
    </svg>
  );
}

export function DotsIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GanttIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 6.5h8M8 12h9M6 17.5h7" />
      <path d="M4 3v18" opacity="0.4" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 19V5m0 0l-6 6m6-6l6 6" />
    </svg>
  );
}

export function MinusIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function AlertOctagonIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" />
      <path d="M12 8v4.5" />
      <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FlameIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 21c3.9 0 6.5-2.5 6.5-6 0-2.4-1.3-4.4-2.6-6-.5 1-1.1 1.7-1.9 2.2.2-3-1-6.3-3.5-8.2.1 2.4-.7 4.2-2.2 5.9C6.8 10.6 5.5 12.6 5.5 15c0 3.5 2.6 6 6.5 6z" />
      <path d="M12 21c-1.7 0-2.8-1.2-2.8-2.9 0-1.4 1-2.5 2.8-4.1 1.8 1.6 2.8 2.7 2.8 4.1 0 1.7-1.1 2.9-2.8 2.9z" />
    </svg>
  );
}

export function MergeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <path d="M6 8.2v2.3a4 4 0 0 0 4 4h5.8M6 15.8v-2" />
    </svg>
  );
}
