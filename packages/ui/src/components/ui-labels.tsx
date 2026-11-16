import * as React from 'react';

/**
 * The screen-reader-only strings the primitives in this package render for
 * themselves.
 *
 * WHY A CONTEXT RATHER THAN PROPS. `@repo/ui` has no i18n catalog by design
 * (see the note in pagination.tsx), so every user-facing string is normally a
 * required prop and the app supplies it. That works when there is ONE call site
 * per string. It does not work for these: `DialogContent` renders "Close" at 23
 * call sites, `Spinner` renders "Loading" wherever a button is busy, and the
 * mobile sidebar renders three of them from inside `Sidebar`, which the app
 * never passes through. Making those props required would put the same literal
 * in 23 files, where the failure mode is one of them drifting, and would make
 * adding a dialog a chore that can be got wrong silently.
 *
 * So this is the exception, and it is deliberately narrow: only strings a
 * PRIMITIVE emits about ITSELF, never content. Anything the app is describing
 * (a button's purpose, an empty state, an error) stays a prop.
 *
 * The defaults are English so a consumer that mounts no provider still renders
 * a name rather than nothing; the apps mount one in their root layout
 * with their catalog copy.
 */
export interface IUiLabels {
  /** Corner close button on a dialog, sheet or drawer. */
  readonly close: string;
  /** Busy indicator with no caption of its own. */
  readonly loading: string;
  /** The control that opens and closes the sidebar. */
  readonly toggleSidebar: string;
  /** Accessible name of the mobile sidebar sheet. */
  readonly sidebarTitle: string;
  /** What the mobile sidebar sheet is, for the sheet's description. */
  readonly sidebarDescription: string;
  /** Region name sonner puts on the toast container. */
  readonly notifications: string;
}

export const DEFAULT_UI_LABELS: IUiLabels = {
  close: 'Close',
  loading: 'Loading',
  toggleSidebar: 'Toggle sidebar',
  sidebarTitle: 'Sidebar',
  sidebarDescription: 'Displays the mobile sidebar.',
  notifications: 'Notifications',
};

const UiLabelsContext = React.createContext<IUiLabels>(DEFAULT_UI_LABELS);

/**
 * Mount once at the app root. Partial values are merged over the defaults, so
 * an app can translate the strings it cares about without restating the rest.
 */
function UiLabelsProvider({
  labels,
  children,
}: {
  labels?: Partial<IUiLabels> | undefined;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => (labels === undefined ? DEFAULT_UI_LABELS : { ...DEFAULT_UI_LABELS, ...labels }),
    [labels],
  );

  return <UiLabelsContext.Provider value={value}>{children}</UiLabelsContext.Provider>;
}

/** Read the labels. Safe outside a provider: the English defaults apply. */
function useUiLabels(): IUiLabels {
  return React.useContext(UiLabelsContext);
}

export { UiLabelsProvider, useUiLabels };
