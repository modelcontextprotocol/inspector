/**
 * Layout constants for consistent spacing throughout the app.
 * These values correspond to Tailwind classes used in AppLayout.
 */
export const LAYOUT = {
  /** Header height: h-14 = 3.5rem = 56px */
  HEADER_HEIGHT: 56,
  /** Main content padding: p-4 = 1rem = 16px */
  PAGE_PADDING: 16,
  /** Total vertical offset for full-height content panels */
  CONTENT_OFFSET: 88, // header + top padding + bottom padding
} as const;

/** CSS calc string for full-height content panels */
export const CONTENT_HEIGHT = `calc(100vh - ${LAYOUT.CONTENT_OFFSET}px)`;
