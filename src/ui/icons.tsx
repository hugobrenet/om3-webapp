import type { SVGProps } from "react";

/**
 * Menu icons, drawn here rather than imported from a library.
 *
 * The historical collector uses solid Font Awesome 5 glyphs; we stay in that register
 * — solid silhouettes on a 24 grid, no thin outline — without adding an npm
 * dependency nor shipping a whole font for seven pictograms. The paths are written by
 * hand: reusing those of Font Awesome would require its CC BY attribution.
 *
 * Every icon inherits `currentColor`, the colour being carried by the caller's class.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Dashboard: the collector's warning triangle (fa-exclamation-triangle). */
export function AlertTriangleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.2c.6 0 1.1.3 1.4.8l8.2 14.2c.6 1-.1 2.3-1.3 2.3H3.7c-1.2 0-1.9-1.3-1.3-2.3l8.2-14.2c.3-.5.8-.8 1.4-.8Zm0 5a1 1 0 0 0-1 1.1l.4 4.6a.6.6 0 0 0 1.2 0l.4-4.6a1 1 0 0 0-1-1.1Zm0 8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" />
    </Svg>
  );
}

/** Nodes: the rack server (fa-server). */
export function ServerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 4h17c.8 0 1.5.7 1.5 1.5v3c0 .8-.7 1.5-1.5 1.5h-17C2.7 10 2 9.3 2 8.5v-3C2 4.7 2.7 4 3.5 4Zm2 1.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm3.2 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM3.5 14h17c.8 0 1.5.7 1.5 1.5v3c0 .8-.7 1.5-1.5 1.5h-17C2.7 20 2 19.3 2 18.5v-3c0-.8.7-1.5 1.5-1.5Zm2 1.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm3.2 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
    </Svg>
  );
}

/**
 * Services: a stack of objects. The historical collector uses a filled circle
 * (fa-circle), but that glyph already stands for the "up" state in StatusBadge:
 * reusing it in the menu would make the two easy to confuse.
 */
/** Kinds of things, a circle, a square and a triangle: the history grouped by kind (as oc3). */
export function ShapesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm6.5 1.5c0-.6.4-1 1-1h6c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1h-6a1 1 0 0 1-1-1V4Zm-1.6 8.9c.4-.7 1.4-.7 1.8 0l4.9 7.6c.4.7 0 1.5-.9 1.5H7.9c-.8 0-1.3-.8-.9-1.5l4.9-7.6Z" />
    </Svg>
  );
}

export function StackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.6 22 7.3l-10 4.7L2 7.3l10-4.7Zm8.4 8.2 1.6.7-10 4.7-10-4.7 1.6-.7L12 14.6l8.4-3.8Zm0 4.6 1.6.8-10 4.7-10-4.7 1.6-.8L12 19.2l8.4-3.8Z" />
    </Svg>
  );
}

/** Networks: the wired nodes (fa-network-wired). */
export function NetworkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3h6c.6 0 1 .4 1 1v3c0 .6-.4 1-1 1h-2v2h5.5c.3 0 .5.2.5.5V13h1c.6 0 1 .4 1 1v3c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1v-3c0-.6.4-1 1-1h1v-1.5h-11V13h1c.6 0 1 .4 1 1v3c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1v-3c0-.6.4-1 1-1h1v-1.5c0-.3.2-.5.5-.5H11V8H9c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1Z" />
    </Svg>
  );
}

/** Switches: the front of a switch, a box with a row of ports. */
export function SwitchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 7h17c.8 0 1.5.7 1.5 1.5v7c0 .8-.7 1.5-1.5 1.5h-17c-.8 0-1.5-.7-1.5-1.5v-7C2 7.7 2.7 7 3.5 7Zm1.3 3.5v3h2.4v-3H4.8Zm4.2 0v3h2.4v-3H9Zm4.2 0v3h2.4v-3h-2.4Zm4.2 0v3h2.4v-3h-2.4Z" />
    </Svg>
  );
}

/** Disks: the database cylinder (fa-database). */
export function DatabaseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5c4.4 0 8 1.2 8 2.8S16.4 8 12 8 4 6.8 4 5.3s3.6-2.8 8-2.8ZM4 8.2C5.6 9.2 8.6 9.8 12 9.8s6.4-.6 8-1.6v3.1c0 1.5-3.6 2.7-8 2.7s-8-1.2-8-2.7V8.2Zm0 5.7c1.6 1 4.6 1.6 8 1.6s6.4-.6 8-1.6v4.8c0 1.5-3.6 2.8-8 2.8s-8-1.3-8-2.8v-4.8Z" />
    </Svg>
  );
}

/** Application codes: the collector's asterisk (fa-asterisk). */
export function AsteriskIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.6 3h2.8v6l5.2-3 1.4 2.4-5.2 3 5.2 3-1.4 2.4-5.2-3v6h-2.8v-6l-5.2 3L4 14.4l5.2-3-5.2-3L5.4 6l5.2 3V3Z" />
    </Svg>
  );
}

/** A tag: the collector's label with its eyelet (fa-tag, `tag16`). */
export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3h6.4a1.5 1.5 0 0 1 1.06.44l8.6 8.6a1.5 1.5 0 0 1 0 2.12l-6.4 6.4a1.5 1.5 0 0 1-2.12 0l-8.6-8.6A1.5 1.5 0 0 1 3 10.9V4.5Zm4.5 1.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z"
      />
    </Svg>
  );
}

/** The tags, as a whole: the collector's pair of labels (fa-tags, Tags menu entry). */
export function TagsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M1.5 4.5A1.5 1.5 0 0 1 3 3h5.9a1.5 1.5 0 0 1 1.06.44l7.6 7.6a1.5 1.5 0 0 1 0 2.12l-5.9 5.9a1.5 1.5 0 0 1-2.12 0l-7.6-7.6A1.5 1.5 0 0 1 1.5 10.4V4.5ZM5.5 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
      />
      <path d="M12.2 3h.9a1.5 1.5 0 0 1 1.06.44l7.6 7.6a1.5 1.5 0 0 1 0 2.12l-5.9 5.9a.9.9 0 0 1-1.27-1.27l5.54-5.54a.6.6 0 0 0 0-.85L12.2 3Z" />
    </Svg>
  );
}

/** Groups: the collector's silhouettes (fa-users). */
/** Service instance: the collector's half-filled disc (fa-adjust, `svcinstance`). */
export function InstanceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Zm0 2.2v14.6a7.3 7.3 0 0 0 0-14.6Z" />
    </Svg>
  );
}

/** Obsolescence: the collector's life ring (fa-life-ring, `obs16`). */
export function LifeRingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Zm-4.6 3.3A7.3 7.3 0 0 0 5.8 7.4l2.5 2.5c.4-.7.9-1.2 1.6-1.6L7.4 5.8Zm9.2 0-2.5 2.5c.7.4 1.2.9 1.6 1.6l2.5-2.5a7.3 7.3 0 0 0-1.6-1.6ZM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Zm-3.7 4.7-2.5 2.5c.5.6 1 1.1 1.6 1.6l2.5-2.5c-.7-.4-1.2-.9-1.6-1.6Zm7.4 0c-.4.7-.9 1.2-1.6 1.6l2.5 2.5c.6-.5 1.1-1 1.6-1.6l-2.5-2.5Z"
      />
    </Svg>
  );
}

/** Refresh: the two arrows in a circle (fa-sync). */
export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5a7.5 7.5 0 0 1 6.9 4.5H16a1 1 0 1 0 0 2h5a1 1 0 0 0 1-1V5a1 1 0 1 0-2 0v2.1A9.5 9.5 0 0 0 2.6 10.8a1 1 0 0 0 2 .3A7.5 7.5 0 0 1 12 4.5Zm8.6 7.8a1 1 0 0 0-1.2.9A7.5 7.5 0 0 1 5.1 15H8a1 1 0 1 0 0-2H3a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0v-2.1a9.5 9.5 0 0 0 17.4-3.7 1 1 0 0 0-.8-1Z" />
    </Svg>
  );
}

/** Log: the collector's clock turning back time (fa-history, `log16`). */
export function HistoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.5 3a9 9 0 1 1-8.3 12.5 1 1 0 0 1 1.9-.8A7 7 0 1 0 6 8.4h2.3a1 1 0 1 1 0 2H3.7a1 1 0 0 1-1-1V4.8a1 1 0 0 1 2 0v1.8A9 9 0 0 1 12.5 3Zm-.2 4c.6 0 1 .4 1 1v3.6l2.6 1.6a1 1 0 1 1-1 1.7l-3.1-1.9a1 1 0 0 1-.5-.9V8c0-.6.4-1 1-1Z" />
    </Svg>
  );
}

/** Filter: the collector's funnel (fa-filter, `filter16`). */
export function FilterIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 4h17a1 1 0 0 1 .8 1.6L14.5 14v5.4a1 1 0 0 1-.5.9l-3 1.7a1 1 0 0 1-1.5-.9V14L2.7 5.6A1 1 0 0 1 3.5 4Z" />
    </Svg>
  );
}

/** User: the collector's single silhouette (fa-user, `guy16`). */
export function UserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 1.8c-3.9 0-8 2-8 4.7V21h16v-2.5c0-2.7-4.1-4.7-8-4.7Z" />
    </Svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.2.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.5 12.6c-3.2 0-6.5 1.6-6.5 3.7V20h13v-3.7c0-2.1-3.3-3.7-6.5-3.7Zm8.2.3c-.7 0-1.4.1-2 .3 1.3 1 2.1 2.3 2.1 3.7V20H22v-3.3c0-1.9-2.6-3.1-5.3-3.1Z" />
    </Svg>
  );
}

/* --- Utility icons. Neutral: these are commands, not objects. --- */

/** Opening a dropdown menu. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z" />
    </Svg>
  );
}

/** Sign out (fa-sign-out-alt). */
export function SignOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3h7a1 1 0 1 1 0 2H5v14h7a1 1 0 1 1 0 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm11.3 4.3a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4l2.3-2.3H9a1 1 0 1 1 0-2h9.6l-2.3-2.3a1 1 0 0 1 0-1.4Z" />
    </Svg>
  );
}

/** Column picker. */
export function ColumnsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 4h4c.3 0 .5.2.5.5v15c0 .3-.2.5-.5.5h-4a.5.5 0 0 1-.5-.5v-15c0-.3.2-.5.5-.5Zm6.5 0h4c.3 0 .5.2.5.5v15c0 .3-.2.5-.5.5h-4a.5.5 0 0 1-.5-.5v-15c0-.3.2-.5.5-.5Zm6.5 0h4c.3 0 .5.2.5.5v15c0 .3-.2.5-.5.5h-4a.5.5 0 0 1-.5-.5v-15c0-.3.2-.5.5-.5Z" />
    </Svg>
  );
}

/** Filter field. */
export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.5 3a7.5 7.5 0 1 1-4.7 13.3l-2.6 2.6a1.2 1.2 0 0 1-1.7-1.7l2.6-2.6A7.5 7.5 0 0 1 10.5 3Zm0 2.4a5.1 5.1 0 1 0 0 10.2 5.1 5.1 0 0 0 0-10.2Z" />
    </Svg>
  );
}

/** Charts: a line over two axes (`chart16`, fa-line-chart). */
export function LineChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 3c.6 0 1 .4 1 1v14.5H21a1 1 0 1 1 0 2H3.5a1 1 0 0 1-1-1V4c0-.6.4-1 1-1Zm16.2 3.3a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4 0L10.5 10l-3.3 3.3a1 1 0 0 1-1.4-1.4l4-4a1 1 0 0 1 1.4 0L14 10.6l4.3-4.3a1 1 0 0 1 1.4 0Z" />
    </Svg>
  );
}

/** Reports: the pie chart of the historical collector (`report16`, fa-pie-chart). */
export function PieChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 3.1V13h9.9A9 9 0 1 1 11 3.1Zm2-.1a9 9 0 0 1 8 8h-8V3Z" />
    </Svg>
  );
}

/** Metrics: the code brackets of the historical collector (`metric16`, fa-code). */
export function CodeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.2 3.6a1.1 1.1 0 0 1 .8 1.3l-4 15a1.1 1.1 0 1 1-2.1-.6l4-15a1.1 1.1 0 0 1 1.3-.7ZM7.3 7.2a1.1 1.1 0 0 1 0 1.6L4.1 12l3.2 3.2a1.1 1.1 0 1 1-1.6 1.6l-4-4a1.1 1.1 0 0 1 0-1.6l4-4a1.1 1.1 0 0 1 1.6 0Zm9.4 0a1.1 1.1 0 0 1 1.6 0l4 4a1.1 1.1 0 0 1 0 1.6l-4 4a1.1 1.1 0 1 1-1.6-1.6l3.2-3.2-3.2-3.2a1.1 1.1 0 0 1 0-1.6Z" />
    </Svg>
  );
}

/** Saving to a file: an arrow down into a tray (fa-download). */
export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3c.7 0 1.2.5 1.2 1.2v7.9l2.4-2.4a1.2 1.2 0 1 1 1.7 1.7l-4.5 4.4a1.2 1.2 0 0 1-1.6 0l-4.5-4.4a1.2 1.2 0 1 1 1.7-1.7l2.4 2.4V4.2c0-.7.5-1.2 1.2-1.2ZM4.2 15.5c.7 0 1.2.5 1.2 1.2v1.9h13.2v-1.9a1.2 1.2 0 1 1 2.4 0v2.5c0 1-.8 1.8-1.8 1.8H4.8C3.8 21 3 20.2 3 19.2v-2.5c0-.7.5-1.2 1.2-1.2Z" />
    </Svg>
  );
}

/** Sends a file: the arrow of the download, going up. */
export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 16.6c-.7 0-1.2-.5-1.2-1.2V7.5L8.4 9.9a1.2 1.2 0 1 1-1.7-1.7l4.5-4.4a1.2 1.2 0 0 1 1.6 0l4.5 4.4a1.2 1.2 0 1 1-1.7 1.7l-2.4-2.4v7.9c0 .7-.5 1.2-1.2 1.2ZM4.2 15.5c.7 0 1.2.5 1.2 1.2v1.9h13.2v-1.9a1.2 1.2 0 1 1 2.4 0v2.5c0 1-.8 1.8-1.8 1.8H4.8C3.8 21 3 20.2 3 19.2v-2.5c0-.7.5-1.2 1.2-1.2Z" />
    </Svg>
  );
}

/** Back to the default values. */
export function ResetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4a8 8 0 1 1-7.6 10.5 1.2 1.2 0 0 1 2.3-.8A5.6 5.6 0 1 0 12 6.4c-1.4 0-2.7.5-3.7 1.4l1.9 1.9c.4.4.1 1-.4 1H4.3a.6.6 0 0 1-.6-.6V4.6c0-.5.6-.8 1-.4l1.6 1.6A8 8 0 0 1 12 4Z" />
    </Svg>
  );
}

/** Closing a panel. */
export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.2 4.5 12 10.3l5.8-5.8a1.2 1.2 0 0 1 1.7 1.7L13.7 12l5.8 5.8a1.2 1.2 0 0 1-1.7 1.7L12 13.7l-5.8 5.8a1.2 1.2 0 0 1-1.7-1.7l5.8-5.8-5.8-5.8a1.2 1.2 0 0 1 1.7-1.7Z" />
    </Svg>
  );
}

/** A record kept in the history: filled when kept, hollow otherwise. */
export function BookmarkIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props}>
      {filled ? (
        <path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.2L5 21V4.5A1.5 1.5 0 0 1 6.5 3Z" />
      ) : (
        <path
          fillRule="evenodd"
          d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.2L5 21V4.5A1.5 1.5 0 0 1 6.5 3Zm.5 2v12.5l5-3 5 3V5H7Z"
        />
      )}
    </Svg>
  );
}

/** Deletion. */
export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.4 2.5h5.2c.6 0 1.1.5 1.1 1.1v1.1h4a1 1 0 1 1 0 2h-.7l-.9 12.1a2.2 2.2 0 0 1-2.2 2.1H8.1a2.2 2.2 0 0 1-2.2-2.1L5 6.7h-.7a1 1 0 1 1 0-2h4V3.6c0-.6.5-1.1 1.1-1.1Zm.7 2.2h3.8v-.2h-3.8v.2ZM9.9 9a.8.8 0 0 0-.8.8v7.6a.8.8 0 0 0 1.6 0V9.8a.8.8 0 0 0-.8-.8Zm4.2 0a.8.8 0 0 0-.8.8v7.6a.8.8 0 0 0 1.6 0V9.8a.8.8 0 0 0-.8-.8Z" />
    </Svg>
  );
}

/**
 * Clusters: three cells packed together, members of one whole, as oc3 draws them. The
 * open ring they had read as a loading spinner in a menu.
 */
export function HoneycombIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l3.98 2.3v4.6L12 12.7l-3.98-2.3V5.8ZM7.52 11.3l3.98 2.3v4.6l-3.98 2.3-3.98-2.3v-4.6ZM16.48 11.3l3.98 2.3v4.6l-3.98 2.3-3.98-2.3v-4.6Z" />
    </Svg>
  );
}

/* --- Column families, taken from the classes of the historical collector. --- */

/** Environment (fa-clone). */
export function EnvIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.5 3h11c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5v-11C7 3.7 7.7 3 8.5 3ZM4.5 7H6v9.5c0 .8.7 1.5 1.5 1.5H17v1.5c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5v-11C3 7.7 3.7 7 4.5 7Z" />
    </Svg>
  );
}

/** Security zone (fa-fire). */
export function FirewallIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.2c.3 2.6-.8 4.2-2.1 5.7-1.4 1.6-3 3.1-3 6.1a5.1 5.1 0 0 0 10.2 0c0-1.4-.5-2.5-1.2-3.5-.3.7-.9 1.2-1.7 1.2-1.1 0-1.8-.8-1.8-2 0-2.1.7-4.6-.4-7.5Zm0 11.1c1 1.3 1.6 2 1.6 3a1.6 1.6 0 0 1-3.2 0c0-1 .6-1.7 1.6-3Z" />
    </Svg>
  );
}

/** Location (fa-map-marker). */
export function LocationIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.2a7 7 0 0 0-7 7c0 5 6.2 12 6.4 12.3.3.4.9.4 1.2 0 .2-.3 6.4-7.3 6.4-12.3a7 7 0 0 0-7-7Zm0 9.8a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8Z" />
    </Svg>
  );
}

/** Hypervisor (fa-cloud). */
export function CloudIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.6 10.1a5.6 5.6 0 0 0-10.5-1.7A4.6 4.6 0 0 0 7.6 19h9.6a4.5 4.5 0 0 0 .4-8.9Z" />
    </Svg>
  );
}

/** Operating system. */
export function OsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16c.8 0 1.5.7 1.5 1.5v13c0 .8-.7 1.5-1.5 1.5H4c-.8 0-1.5-.7-1.5-1.5v-13C2.5 4.7 3.2 4 4 4Zm0 4.6v9.4h16V8.6H4Zm1.6-3.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2.8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    </Svg>
  );
}

/** Processor (fa-microchip). */
export function CpuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.2 2a.8.8 0 0 1 .8.8V4h1.2V2.8a.8.8 0 1 1 1.6 0V4H14V2.8a.8.8 0 1 1 1.6 0V4h1.1c1.3 0 2.3 1 2.3 2.3v1.1h1.2a.8.8 0 1 1 0 1.6H19v1.2h1.2a.8.8 0 1 1 0 1.6H19v1.2h1.2a.8.8 0 1 1 0 1.6H19v1.1c0 1.3-1 2.3-2.3 2.3h-1.1V20a.8.8 0 1 1-1.6 0v-1.2h-1.2V20a.8.8 0 1 1-1.6 0v-1.2H10V20a.8.8 0 1 1-1.6 0v-1.2H7.3A2.3 2.3 0 0 1 5 16.5v-1.1H3.8a.8.8 0 1 1 0-1.6H5v-1.2H3.8a.8.8 0 1 1 0-1.6H5V9.8H3.8a.8.8 0 1 1 0-1.6H5V7.1c0-1.3 1-2.3 2.3-2.3h1.1V2.8c0-.4.4-.8.8-.8Zm-.7 6.2c-.3 0-.5.2-.5.5v6.6c0 .3.2.5.5.5h6.6c.3 0 .5-.2.5-.5V8.7c0-.3-.2-.5-.5-.5H8.5Z" />
    </Svg>
  );
}

/** Memory (fa-memory). */
export function MemoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.8 6h18.4c.7 0 1.3.6 1.3 1.3V11h-.8c-.7 0-1.2.6-1.2 1.3s.5 1.2 1.2 1.2h.8v3.2c0 .7-.6 1.3-1.3 1.3H2.8c-.7 0-1.3-.6-1.3-1.3v-3.2h.8c.7 0 1.2-.5 1.2-1.2s-.5-1.3-1.2-1.3h-.8V7.3C1.5 6.6 2.1 6 2.8 6Zm3.4 3.2v4.2h2.2V9.2H6.2Zm4.5 0v4.2h2.2V9.2h-2.2Zm4.5 0v4.2h2.2V9.2h-2.2Z" />
    </Svg>
  );
}

/** Timestamp (fa-clock). */
export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Zm0 2.2a7.3 7.3 0 1 0 0 14.6 7.3 7.3 0 0 0 0-14.6Zm-.1 2.3c.5 0 1 .4 1 1v4.3l3 1.8c.4.3.6.9.3 1.3-.3.5-.9.6-1.3.3l-3.5-2.1a1 1 0 0 1-.5-.9V8a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

/** Date, in front of a timestamp in the lists (fa-calendar-alt). */
export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M8 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1ZM5 10v9h14v-9H5Zm2 2h4v4H7v-4Z"
      />
    </Svg>
  );
}

/** Power supply (fa-bolt). */
export function PowerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.6 2 5.8 12.4c-.4.5-.1 1.2.6 1.2h4.2l-1.4 8 8.9-10.4c.4-.5.1-1.2-.6-1.2h-4.2l1.3-8Z" />
    </Svg>
  );
}

/** Notifications (fa-bell). */
export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.2c.9 0 1.6.7 1.6 1.6v.6a6.2 6.2 0 0 1 4.6 6v2.8l1.5 2.4c.4.6 0 1.4-.8 1.4H5.1c-.7 0-1.2-.8-.8-1.4l1.5-2.4v-2.8a6.2 6.2 0 0 1 4.6-6v-.6c0-.9.7-1.6 1.6-1.6Zm0 19.6a2.6 2.6 0 0 1-2.5-2h5a2.6 2.6 0 0 1-2.5 2Z" />
    </Svg>
  );
}

/** Disaster recovery plan (fa-bomb, the collector's `drp16` class). */
export function DrpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.6 3a1 1 0 0 1 1 1v.6h.6a1 1 0 1 1 0 2h-.6v.6a1 1 0 1 1-2 0v-.6H16a1 1 0 1 1 0-2h.6V4a1 1 0 0 1 1-1Zm-3.1 3.6 1.3 1.3-1.5 1.5a7.5 7.5 0 1 1-2.1-1.4l1.4-1.4ZM9.5 11a4.5 4.5 0 0 0-3.2 1.3 1 1 0 1 0 1.4 1.4A2.5 2.5 0 0 1 9.5 13a1 1 0 1 0 0-2Z" />
    </Svg>
  );
}

/** State of an object, rendered as a badge. */
export function StateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 6.5h9a5.5 5.5 0 0 1 0 11h-9a5.5 5.5 0 0 1 0-11Zm0 2a3.5 3.5 0 1 0 0 7h9a3.5 3.5 0 1 0 0-7h-9Zm0 1.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z" />
    </Svg>
  );
}

/** Editing, a configuration file say. */
export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.6 2.6c.5 0 1 .2 1.4.6l1.8 1.8a2 2 0 0 1 0 2.8L9.2 19.4l-5.7 1.9a.7.7 0 0 1-.9-.9l1.9-5.7L16.2 3.2c.4-.4.9-.6 1.4-.6Zm-2.2 3.9L6 15.9l-1 3.1 3.1-1 9.4-9.4-2.1-2.1Z" />
    </Svg>
  );
}

/** Setting parameters one by one, as a wizard does: three sliders. */
export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="3" y="11" width="18" height="2" rx="1" />
      <rect x="3" y="17" width="18" height="2" rx="1" />
      <circle cx="8" cy="6" r="2.6" />
      <circle cx="16" cy="12" r="2.6" />
      <circle cx="10" cy="18" r="2.6" />
    </Svg>
  );
}

/** Copying to the clipboard: two sheets, one over the other. */
export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 2.5h9.5A2.5 2.5 0 0 1 21 5v11.5a2.5 2.5 0 0 1-2.5 2.5H17v-2.2h1.5c.2 0 .3-.1.3-.3V5c0-.2-.1-.3-.3-.3H9c-.2 0-.3.1-.3.3v.8H6.5V5A2.5 2.5 0 0 1 9 2.5ZM5.5 7h9.5a2.5 2.5 0 0 1 2.5 2.5V19a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 19V9.5A2.5 2.5 0 0 1 5.5 7Zm0 2.2c-.2 0-.3.1-.3.3V19c0 .2.1.3.3.3H15c.2 0 .3-.1.3-.3V9.5c0-.2-.1-.3-.3-.3H5.5Z" />
    </Svg>
  );
}

/** Confirming an entry. */
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.3 5.6a1.2 1.2 0 0 1 0 1.7L10 17.6a1.2 1.2 0 0 1-1.7 0l-4.6-4.6a1.2 1.2 0 1 1 1.7-1.7l3.7 3.7 9.5-9.4a1.2 1.2 0 0 1 1.7 0Z" />
    </Svg>
  );
}

/** Folder of forms, in the request catalog (fa-folder-open). */
export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 5h5.2c.5 0 .9.2 1.2.6L11 7h7.5c.8 0 1.5.7 1.5 1.5V10H7.2c-.7 0-1.3.4-1.5 1.1L3 18.2V6.5C3 5.7 3.7 5 4.5 5h-1Zm3.7 6.5h14.3c.7 0 1.2.7.9 1.4l-2.3 6c-.2.6-.8 1.1-1.5 1.1H4.1c-.7 0-1.2-.7-.9-1.4l2.5-6c.3-.7.8-1.1 1.5-1.1Z" />
    </Svg>
  );
}

/** Form: the collector's puzzle piece (fa-puzzle-piece, `wf16`). */
export function PuzzleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3.5a2.5 2.5 0 0 1 5 0V5h3.5c.8 0 1.5.7 1.5 1.5V10h-1.5a2.5 2.5 0 0 0 0 5H20v3.5c0 .8-.7 1.5-1.5 1.5H15v-1.5a2.5 2.5 0 0 0-5 0V20H6.5c-.8 0-1.5-.7-1.5-1.5V15H3.5a2.5 2.5 0 0 1 0-5H5V6.5C5 5.7 5.7 5 6.5 5H10V3.5Z" />
    </Svg>
  );
}

/** Adding an item to a list. */
export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5c.7 0 1.2.5 1.2 1.2v6.1h6.1a1.2 1.2 0 1 1 0 2.4h-6.1v6.1a1.2 1.2 0 1 1-2.4 0v-6.1H4.7a1.2 1.2 0 1 1 0-2.4h6.1V4.7c0-.7.5-1.2 1.2-1.2Z" />
    </Svg>
  );
}

/** Freezing of an object: the historical collector's snowflake (fa-snowflake). */
export function SnowflakeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 1.8c.6 0 1.1.5 1.1 1.1v1.5l1.3-1.3a1.1 1.1 0 0 1 1.6 1.6l-2.9 2.9v2.5l2.2-1.3 1-4a1.1 1.1 0 1 1 2.2.6l-.5 1.8 1.3-.8a1.1 1.1 0 1 1 1.1 2l-1.3.7 1.8.5a1.1 1.1 0 0 1-.6 2.2l-4-1.1-2.2 1.3 2.2 1.3 4-1.1a1.1 1.1 0 0 1 .6 2.2l-1.8.5 1.3.7a1.1 1.1 0 1 1-1.1 2l-1.3-.8.5 1.8a1.1 1.1 0 1 1-2.2.6l-1-4-2.2-1.3v2.5l2.9 2.9a1.1 1.1 0 0 1-1.6 1.6l-1.3-1.3v1.5a1.1 1.1 0 1 1-2.2 0v-1.5l-1.3 1.3a1.1 1.1 0 0 1-1.6-1.6l2.9-2.9v-2.5l-2.2 1.3-1 4a1.1 1.1 0 1 1-2.2-.6l.5-1.8-1.3.8a1.1 1.1 0 1 1-1.1-2l1.3-.7-1.8-.5a1.1 1.1 0 0 1 .6-2.2l4 1.1 2.2-1.3-2.2-1.3-4 1.1a1.1 1.1 0 1 1-.6-2.2l1.8-.5-1.3-.7a1.1 1.1 0 1 1 1.1-2l1.3.8-.5-1.8a1.1 1.1 0 0 1 2.2-.6l1 4 2.2 1.3V7.6L8 4.7a1.1 1.1 0 0 1 1.6-1.6l1.3 1.3V2.9c0-.6.5-1.1 1.1-1.1Z" />
    </Svg>
  );
}

/*
 * Glyphs of the historical icon classes a form definition names (LabelCss, Css,
 * FolderCss), translated by src/components/opensvc/legacy-css.ts.
 */

/** Actions (`action16`, fa-cog). */
export function GearIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M10.3 2h3.4l.5 2.6 1.6.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.6 2.6.5v3.4l-2.6.5-.7 1.6 1.5 2.2-2.4 2.4-2.2-1.5-1.6.7-.5 2.6h-3.4l-.5-2.6-1.6-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.6L2 13.7v-3.4l2.6-.5.7-1.6-1.5-2.2 2.4-2.4 2.2 1.5 1.6-.7.5-2.6ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
      />
    </Svg>
  );
}

/** Actions on a record or a selection: a bolt, apart from the gear of the settings. */
export function BoltIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.5L13.5 2Z" />
    </Svg>
  );
}

/** Compliance (`comp16`, fa-bullseye). */
export function TargetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2.8a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4Zm0 2.7a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2.4a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z"
      />
    </Svg>
  );
}

/** Packages (`pkg16`, fa-cubes). */
export function CubeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2 21 6.5v11L12 22l-9-4.5v-11L12 2Zm0 2.4L5.7 7.5 12 10.6l6.3-3.1L12 4.4Z"
      />
    </Svg>
  );
}

/** Keys and secrets (`key`, fa-key). */
export function KeyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M8 3.5a6 6 0 0 1 5.7 7.9l8.3 8.3V22h-3.5v-2h-2v-2h-2l-1.9-1.9A6 6 0 1 1 8 3.5Zm-1.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
      />
    </Svg>
  );
}

/** Files (`file16`, fa-file). */
export function FileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 2H13v5.5c0 .8.7 1.5 1.5 1.5H20v11.5c0 .8-.7 1.5-1.5 1.5h-12c-.8 0-1.5-.7-1.5-1.5v-17C5 2.7 5.7 2 6.5 2Zm8 .4 5.1 5.1h-5.1V2.4Z" />
    </Svg>
  );
}

/** Locked, safe (`safe16`, fa-lock). */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a5 5 0 0 1 5 5v3h1.5c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-13C4.7 22 4 21.3 4 20.5v-9c0-.8.7-1.5 1.5-1.5H7V7a5 5 0 0 1 5-5Zm0 2.2A2.8 2.8 0 0 0 9.2 7v3h5.6V7A2.8 2.8 0 0 0 12 4.2Z"
      />
    </Svg>
  );
}

/** Mail (fa-envelope). */
export function MailIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 5h17c.8 0 1.5.7 1.5 1.5v.7l-10 6.2L2 7.2v-.7C2 5.7 2.7 5 3.5 5ZM2 9.5l10 6.2 10-6.2v8c0 .8-.7 1.5-1.5 1.5h-17C2.7 19 2 18.3 2 17.5v-8Z" />
    </Svg>
  );
}

/** Name resolution (`dns16`). */
export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 1.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z"
      />
      <path
        fillRule="evenodd"
        d="M12 2.5c2.6 2.2 4.1 5.7 4.1 9.5s-1.5 7.3-4.1 9.5c-2.6-2.2-4.1-5.7-4.1-9.5s1.5-7.3 4.1-9.5Zm0 2.6c-1.5 1.8-2.3 4.3-2.3 6.9s.8 5.1 2.3 6.9c1.5-1.8 2.3-4.3 2.3-6.9s-.8-5.1-2.3-6.9Z"
      />
      <path d="M2.5 11.1h19v1.8h-19z" />
    </Svg>
  );
}

/** Links (`link16`, fa-link). */
export function LinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.2 14.8a1 1 0 0 1 0-1.4l4.2-4.2a1 1 0 1 1 1.4 1.4l-4.2 4.2a1 1 0 0 1-1.4 0Zm-1.6-4 1.4 1.4-2.1 2.1a2 2 0 0 0 2.8 2.8l2.1-2.1 1.4 1.4-2.1 2.1a4 4 0 0 1-5.6-5.6l2.1-2.1Zm8.8 2.4-1.4-1.4 2.1-2.1a2 2 0 0 0-2.8-2.8l-2.1 2.1-1.4-1.4 2.1-2.1a4 4 0 0 1 5.6 5.6l-2.1 2.1Z" />
    </Svg>
  );
}

/** Back to the parent (`parentfolder`, fa-arrow-left). */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.7 5.3a1.2 1.2 0 0 1 0 1.7l-3.8 3.8H19a1.2 1.2 0 1 1 0 2.4H6.9l3.8 3.8a1.2 1.2 0 1 1-1.7 1.7l-5.8-5.8a1.2 1.2 0 0 1 0-1.7L9 5.3a1.2 1.2 0 0 1 1.7 0Z" />
    </Svg>
  );
}

/** Pointing onward (`right16`, fa-caret-right). */
export function CaretRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 5.5v13c0 .9 1 1.3 1.7.7l6.5-6.5a1 1 0 0 0 0-1.4L10.7 4.8C10 4.2 9 4.6 9 5.5Z" />
    </Svg>
  );
}

/** Next step (fa-step-forward). */
export function StepForwardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5.4v13.2c0 .8.9 1.3 1.6.8L15 13.1v5.4a1.5 1.5 0 0 0 3 0v-13a1.5 1.5 0 0 0-3 0v5.4L6.6 4.6C5.9 4.1 5 4.6 5 5.4Z" />
    </Svg>
  );
}

/** Previous step (fa-step-backward). */
export function StepBackwardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 5.4v13.2c0 .8-.9 1.3-1.6.8L9 13.1v5.4a1.5 1.5 0 0 1-3 0v-13a1.5 1.5 0 0 1 3 0v5.4l8.4-6.3c.7-.5 1.6 0 1.6.8Z" />
    </Svg>
  );
}

/** Ordering (fa-sort). */
export function SortIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5 18 9H6l6-6.5Zm0 19L6 15h12l-6 6.5Z" />
    </Svg>
  );
}

/** Feeds, subscriptions (fa-rss). */
export function RssIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3.5A15.5 15.5 0 0 1 20.5 19h-3A12.5 12.5 0 0 0 5 6.5v-3Zm0 6a9.5 9.5 0 0 1 9.5 9.5h-3A6.5 6.5 0 0 0 5 12.5v-3Zm2 7.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
    </Svg>
  );
}

/** A command line: the prompt and its cursor. */
export function TerminalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v12h16V6H4Zm2.3 3.7 1.4-1.4L11.4 12l-3.7 3.7-1.4-1.4L8.6 12 6.3 9.7ZM12 14h5v2h-5v-2Z"
      />
    </Svg>
  );
}

/**
 * A window with its side panel: the control that folds or unfolds a sidebar. The
 * panel is filled while it is open, outlined once folded.
 */
export function SidebarIcon({ open = true, ...props }: IconProps & { open?: boolean }) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm5 2v12h9a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-9ZM8 6H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3V6Z"
      />
      {open && <path d="M5 8.25h2v1.5H5v-1.5Zm0 3h2v1.5H5v-1.5Z" />}
    </Svg>
  );
}

/* --- om3 additions, drawn in the same register: filled shapes on a 24 grid. --- */

/** More actions: three dots in a column (fa-ellipsis-v). */
export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 6.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 6.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
    </Svg>
  );
}

/** Dark mode: a crescent moon (fa-moon). */
export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.2 2.4a1 1 0 0 1 .3 1.3A7.5 7.5 0 0 0 20.3 14a1 1 0 0 1 1.2 1.3A10 10 0 1 1 12.9 2.2a1 1 0 0 1 1.3.2Z" />
    </Svg>
  );
}

/** Light mode: a sun (fa-sun). */
export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0-6a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V2a1 1 0 0 1 1-1Zm0 18a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0v-2a1 1 0 0 1 1-1ZM2 11h2a1 1 0 1 1 0 2H2a1 1 0 1 1 0-2Zm18 0h2a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2ZM4.9 3.5l1.4 1.4a1 1 0 0 1-1.4 1.4L3.5 4.9a1 1 0 0 1 1.4-1.4Zm12.8 12.8 1.4 1.4a1 1 0 0 1-1.4 1.4l-1.4-1.4a1 1 0 0 1 1.4-1.4ZM19.1 3.5a1 1 0 0 1 0 1.4l-1.4 1.4a1 1 0 0 1-1.4-1.4l1.4-1.4a1 1 0 0 1 1.4 0ZM6.3 16.3a1 1 0 0 1 0 1.4l-1.4 1.4a1 1 0 0 1-1.4-1.4l1.4-1.4a1 1 0 0 1 1.4 0Z" />
    </Svg>
  );
}

/** Pause: two bars (fa-pause). */
export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm7 0h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

/* --- om3 action icons, same register. --- */

/** Start: a play triangle (fa-play). */
export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 3.7c-.8-.5-1.8.1-1.8 1v14.6c0 .9 1 1.5 1.8 1l11.7-7.3c.7-.5.7-1.5 0-2L7.5 3.7Z" />
    </Svg>
  );
}

/** Stop: a filled square (fa-stop). */
export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </Svg>
  );
}

/** Unprovision, block: a circle crossed by a bar (fa-ban). */
export function BanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm5.6 4.1L6.1 17.6A7.6 7.6 0 0 0 17.6 6.1ZM12 4.4a7.6 7.6 0 0 0-7.6 7.6c0 1.6.5 3.1 1.3 4.3L16.3 5.7A7.6 7.6 0 0 0 12 4.4Z" />
    </Svg>
  );
}

/** Switch over: two opposed arrows (fa-exchange-alt). */
export function SwapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16.3 2.3a1 1 0 0 1 1.4 0l3.6 3.6a1 1 0 0 1 0 1.4l-3.6 3.6a1 1 0 1 1-1.4-1.4l1.9-1.9H4a1 1 0 1 1 0-2h14.2l-1.9-1.9a1 1 0 0 1 0-1.4ZM7.7 12.7a1 1 0 0 1 0 1.4L5.8 16H20a1 1 0 1 1 0 2H5.8l1.9 1.9a1 1 0 1 1-1.4 1.4l-3.6-3.6a1 1 0 0 1 0-1.4l3.6-3.6a1 1 0 0 1 1.4 0Z" />
    </Svg>
  );
}

/** Drain: a drop (fa-tint). */
export function DropIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.3c.4 0 .7.2.9.5 1.4 2.1 6.6 8.5 6.6 12.2a7.5 7.5 0 0 1-15 0c0-3.7 5.2-10.1 6.6-12.2.2-.3.5-.5.9-.5Z" />
    </Svg>
  );
}

/** Enable: a switch turned on (fa-toggle-on). */
export function ToggleOnIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 6h10a6 6 0 1 1 0 12H7A6 6 0 1 1 7 6Zm10 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
    </Svg>
  );
}

/** Disable: a switch turned off (fa-toggle-off). */
export function ToggleOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 6h10a6 6 0 1 1 0 12H7A6 6 0 1 1 7 6Zm0 2a4 4 0 1 0 0 8h10a4 4 0 1 0 0-8H7Zm0 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" />
    </Svg>
  );
}

/** Information: an i in a disc (fa-info-circle). */
export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 8.3c-.7 0-1.2.5-1.2 1.2v5.3a1.2 1.2 0 1 0 2.4 0v-5.3c0-.7-.5-1.2-1.2-1.2Zm0-4.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </Svg>
  );
}

/** Shutdown: the power symbol struck through, apart from boot's plain one. */
export function PowerOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5c.7 0 1.2.5 1.2 1.2v6.6a1.2 1.2 0 1 1-2.4 0V3.7c0-.7.5-1.2 1.2-1.2ZM6.6 5.6a1.2 1.2 0 0 1 .1 1.7 7 7 0 1 0 10.6 0 1.2 1.2 0 1 1 1.8-1.6 9.4 9.4 0 1 1-14.2 0 1.2 1.2 0 0 1 1.7-.1ZM3.4 2l18.6 18.6-1.4 1.4L2 3.4 3.4 2Z" />
    </Svg>
  );
}

/** Reveal: an eye (fa-eye). */
export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5c5 0 8.7 3.6 10.2 6.3.2.4.2.9 0 1.3C20.7 15.4 17 19 12 19S3.3 15.4 1.8 12.6c-.2-.4-.2-.9 0-1.3C3.3 8.6 7 5 12 5Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
    </Svg>
  );
}

/** Hide: an eye struck through (fa-eye-slash). */
export function EyeOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.4 2 22 20.6 20.6 22l-3.3-3.3A10.6 10.6 0 0 1 12 20c-5 0-8.7-3.6-10.2-6.3-.2-.4-.2-.9 0-1.3a16 16 0 0 1 3.6-4.4L2 3.4 3.4 2Zm5.5 8.3a4 4 0 0 0 5.3 5.3l-5.3-5.3ZM12 5c5 0 8.7 3.6 10.2 6.3.2.4.2.9 0 1.3a15.6 15.6 0 0 1-2.6 3.4L15.9 12.3A4 4 0 0 0 11.7 8.1L8.6 5A10 10 0 0 1 12 5Z" />
    </Svg>
  );
}

/** A resource of a service (`resource`, fa-hashtag): its id reads "fs#1". */
export function HashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.2 3.1a1.2 1.2 0 0 1 1 1.4L10.8 8h3.6l.5-3.9a1.2 1.2 0 1 1 2.4.3L16.8 8h2.7a1.2 1.2 0 1 1 0 2.4h-3L16 13.6h2.5a1.2 1.2 0 1 1 0 2.4h-2.8l-.5 3.9a1.2 1.2 0 1 1-2.4-.3l.5-3.6H9.7l-.5 3.9a1.2 1.2 0 1 1-2.4-.3l.5-3.6H4.5a1.2 1.2 0 1 1 0-2.4h3.1l.4-3.2H5.5a1.2 1.2 0 1 1 0-2.4h2.8l.5-3.9a1.2 1.2 0 0 1 1.4-1Zm.3 7.3-.4 3.2h3.6l.4-3.2h-3.6Z" />
    </Svg>
  );
}

/** AI assistant: a speech bubble holding three dots, the conversations with the agent. */
export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M4.5 3.5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8.2l-4.6 3.6a.8.8 0 0 1-1.3-.6v-3h-.9a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2ZM6.2 10.5a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0Zm4.4 0a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0Zm4.4 0a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 1 0-2.8 0Z"
      />
    </Svg>
  );
}

/** Sending a message: a paper plane. */
export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2 3.6a.8.8 0 0 1 .9-.1l16.8 7.8a.8.8 0 0 1 0 1.4L4.1 20.5a.8.8 0 0 1-1.1-.9l1.6-6.4 8.4-1.2-8.4-1.2L3 4.5a.8.8 0 0 1 .2-.9Z" />
    </Svg>
  );
}
