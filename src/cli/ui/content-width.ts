/**
 * Shared content-width context for cards that render inside the left panel.
 *
 * When PlanPanel is open the left column shrinks to 35 % of the terminal width;
 * cards that measure themselves against `stdout.columns` overflow and misalign.
 * This context lets App.tsx broadcast the actual available width, and cards
 * consume it instead of re-measuring from the global terminal size.
 *
 * Cards subtract their own visual padding (border / margin) from the raw
 * container width to derive the inner content budget.
 */

import React, { createContext, useContext } from "react";

const ContentWidthContext = createContext<number>(0);

export { ContentWidthContext };

/** The effective content area width in cells, or 0 when the provider is absent (caller falls back to terminalWidth - padding). */
export function useContentWidth(): number {
  return useContext(ContentWidthContext);
}
