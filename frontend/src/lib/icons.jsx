// Icons — inline SVG stroke icons in the lucide style
import React from "react";

const ICON_BASE = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 18, height: 18, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
};

function mkIcon(paths) {
  return function Icon({ size=18, ...props }) {
    return <svg {...ICON_BASE} width={size} height={size} {...props}>{paths}</svg>;
  };
}

export const IconHome         = mkIcon(<><path d="M3 12 12 3l9 9"/><path d="M5 10v11h5v-6h4v6h5V10"/></>);
export const IconFolder       = mkIcon(<><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>);
export const IconKanban       = mkIcon(<><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="11" rx="1"/></>);
export const IconBuilding     = mkIcon(<><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></>);
export const IconPie          = mkIcon(<><path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M21 12a9 9 0 0 0-9-9v9z" fill="currentColor" fillOpacity="0.15"/></>);
export const IconSwap         = mkIcon(<><path d="M7 7h13l-3-3M17 17H4l3 3"/></>);
export const IconNetwork      = mkIcon(<><circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12l10-6M7 12l10 6"/></>);
export const IconUsers        = mkIcon(<><circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17.5" cy="7.5" r="2.5"/><path d="M22 19c0-2.5-2-4.5-4.5-4.5"/></>);
export const IconPackage      = mkIcon(<><path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></>);
export const IconTruck        = mkIcon(<><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></>);
export const IconClipboard    = mkIcon(<><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/></>);
export const IconMail         = mkIcon(<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>);
export const IconHistory      = mkIcon(<><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></>);
export const IconCreditCard   = mkIcon(<><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></>);
export const IconSearch       = mkIcon(<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>);
export const IconBell         = mkIcon(<><path d="M6 10a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7z"/><path d="M10 20a2 2 0 0 0 4 0"/></>);
export const IconSettings     = mkIcon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></>);
export const IconChevLeft     = mkIcon(<path d="m15 6-6 6 6 6"/>);
export const IconChevRight    = mkIcon(<path d="m9 6 6 6-6 6"/>);
export const IconChevDown     = mkIcon(<path d="m6 9 6 6 6-6"/>);
export const IconChevUp       = mkIcon(<path d="m6 15 6-6 6 6"/>);
export const IconPlus         = mkIcon(<><path d="M12 5v14M5 12h14"/></>);
export const IconX            = mkIcon(<path d="m6 6 12 12M18 6 6 18"/>);
export const IconCheck        = mkIcon(<path d="m5 12 5 5L20 7"/>);
export const IconArrow        = mkIcon(<><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>);
export const IconMore         = mkIcon(<><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>);
export const IconFilter       = mkIcon(<path d="M4 5h16l-6 8v5l-4 2v-7z"/>);
export const IconDownload     = mkIcon(<><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></>);
export const IconUpload       = mkIcon(<><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 21h16"/></>);
export const IconRefresh      = mkIcon(<><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>);
export const IconTrend        = mkIcon(<><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></>);
export const IconDollar       = mkIcon(<><path d="M12 3v18"/><path d="M17 7c0-2-2-3-5-3s-5 1-5 4 10 2 10 5-3 4-5 4-5-1-5-3"/></>);
export const IconClock        = mkIcon(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>);
export const IconAlert        = mkIcon(<><path d="M12 3 1 21h22L12 3z"/><path d="M12 10v4M12 17v.5"/></>);
export const IconShield       = mkIcon(<><path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z"/><path d="M9 12l2 2 4-4"/></>);
export const IconLock         = mkIcon(<><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>);
export const IconEye          = mkIcon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>);
export const IconMapPin       = mkIcon(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></>);
export const IconShip         = mkIcon(<><path d="M3 18s2 2 4 2 3-2 5-2 3 2 5 2 4-2 4-2"/><path d="M5 16 3 11h18l-2 5"/><path d="M9 11V5h6v6"/></>);
export const IconPlane        = mkIcon(<path d="M21 13v-2l-8-3V4a1 1 0 0 0-2 0v4L3 11v2l8-1v5l-2 1v2l3-1 3 1v-2l-2-1v-5z"/>);
export const IconFileText     = mkIcon(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></>);
export const IconUser         = mkIcon(<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></>);
export const IconLogOut       = mkIcon(<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></>);
export const IconGrid         = mkIcon(<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>);
export const IconList         = mkIcon(<><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>);
export const IconSliders      = mkIcon(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>);
export const IconPaperclip    = mkIcon(<path d="m21 12-9.5 9.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L16 7"/>);
export const IconSparkle      = mkIcon(<><path d="m12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></>);
export const IconWarehouse    = mkIcon(<><path d="M3 10v11h18V10L12 4z"/><path d="M7 21v-7h10v7"/><path d="M10 14h4"/></>);
export const IconPercent      = mkIcon(<><path d="m5 19 14-14"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></>);
export const IconTag          = mkIcon(<><path d="M20 12 12 20l-8-8 8-8h8z"/><circle cx="15" cy="9" r="1.25"/></>);
export const IconBoxes        = mkIcon(<><path d="M3 8v12h18V8l-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></>);
export const IconGlobe        = mkIcon(<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>);
export const IconCommand      = mkIcon(<path d="M6 6h3a3 3 0 1 0-3-3v3zM18 6h-3a3 3 0 1 1 3-3v3zM6 18h3a3 3 0 1 1-3 3v-3zM18 18h-3a3 3 0 1 0 3 3v-3zM6 6h12v12H6z"/>);
export const IconPencil       = mkIcon(<><path d="M14 4l6 6L9 21H3v-6z"/><path d="m14 4 6 6"/></>);
export const IconTrash        = mkIcon(<><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></>);
export const IconCopy         = mkIcon(<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>);
// ─── AI Hub ────────────────────────────────────────────────────────────
export const IconBot          = mkIcon(<><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17h6"/></>);
export const IconBrain        = mkIcon(<><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 5 2"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 0 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-5 2"/><path d="M12 5v14"/></>);
export const IconAt           = mkIcon(<><circle cx="12" cy="12" r="4"/><path d="M16 8v6a2 2 0 0 0 4 0v-2a8 8 0 1 0-3 6"/></>);
export const IconHash         = mkIcon(<><path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/></>);
export const IconSend         = mkIcon(<><path d="M3 12 21 3l-7 18-3-9z"/><path d="m11 13 10-10"/></>);
export const IconStop         = mkIcon(<rect x="6" y="6" width="12" height="12" rx="2"/>);
export const IconPin          = mkIcon(<><path d="M12 2v6"/><path d="M9 8h6l1 6H8z"/><path d="M12 14v8"/></>);
export const IconArchive      = mkIcon(<><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8"/><path d="M10 13h4"/></>);
export const IconImage        = mkIcon(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 16-5-5-9 9"/></>);
