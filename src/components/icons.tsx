import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const make = (paths: React.ReactNode, fill = false) =>
  function Icon({ size = 18, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };

export const IconNote = make(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>);
export const IconHeading = make(<><rect x="3" y="7" width="18" height="10" rx="2.5" /><path d="M8 12h8" /></>);
export const IconLink = make(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const IconTodo = make(<><path d="M4 7l2 2 3-3M4 16l2 2 3-3" /><path d="M13 8h7M13 17h7" /></>);
export const IconLine = make(<><path d="M5 19L19 5" /><path d="M12 5h7v7" /></>);
export const IconBoard = make(<><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>);
export const IconColumn = make(<><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h6" /></>);
export const IconTable = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></>);
export const IconComment = make(<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />);
export const IconImage = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>);
export const IconUpload = make(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
export const IconVideo = make(<><rect x="3" y="5" width="13" height="14" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>);
export const IconMusic = make(<><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>);
export const IconFile = make(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconMinus = make(<path d="M5 12h14" />);
export const IconFit = make(<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />);
export const IconTrash = make(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>);
export const IconCopy = make(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>);
export const IconExternal = make(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>);
export const IconPlay = make(<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" />, true);
export const IconPause = make(<><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>, true);
export const IconDownload = make(<><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></>);
export const IconUndo = make(<><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>);
export const IconRedo = make(<><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>);
export const IconHome = make(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>);
export const IconChevron = make(<path d="M9 6l6 6-6 6" />);
export const IconShare = make(<><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>);
export const IconSidebar = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>);
export const IconFront = make(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></>);
export const IconEdit = make(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>);
export const IconX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconBold = make(<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />);
export const IconItalic = make(<path d="M10 5h8M6 19h8M14 5l-4 14" />);
export const IconUnderline = make(<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />);
export const IconStrike = make(<path d="M5 12h14M16 7a4 3 0 0 0-4-2c-2.5 0-4 1.3-4 3M8 17a4 3 0 0 0 4 2c2.5 0 4-1.3 4-3" />);
export const IconList = make(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>);
export const IconOList = make(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5h1.5v4M4 9h3M4 15h3l-3 3h3" /></>);
export const IconH = make(<path d="M6 5v14M18 5v14M6 12h12" />);
export const IconFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconMore = make(<><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>);
export const IconPalette = make(<><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-2 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.2-4-7.5-9-7.5z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="14.5" cy="7" r="1" /></>);
