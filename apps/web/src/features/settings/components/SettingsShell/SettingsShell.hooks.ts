import { useState } from 'react';
import type { ISettingsShellProps, ISettingsShellView } from './SettingsShell.types';

/**
 * Which rail row is open.
 *
 * Local state, not nested routes. The design draws a rail, not
 * a set of pages, and `/settings` is already one route; splitting it into
 * `/settings/profile`, `/settings/security` and so on would rewrite every
 * existing link to `/settings` for a shell that gains nothing from them.
 *
 * The selection is resolved by LOOKUP rather than stored as an index, and falls
 * back to the first row when the id is not in the list. That matters because
 * the rail is not static: `Users` only exists for an admin, so a row can
 * appear or disappear after
 * the first render once `useAuth` resolves. A stale id then resolves to the
 * first row instead of an empty panel, with no effect needed to repair it.
 *
 * `initialSectionId` is followed when it CHANGES, not only read at mount: the
 * two-factor grace banner is shown on `/settings` itself, so its deep link to
 * the security row can arrive while the shell is already mounted on another
 * row. The previous value is kept in state and compared during render (React's
 * "adjust state when a prop changes" pattern), which switches the row in the
 * same render instead of painting the old one first and fixing it in an
 * effect. A change back to `undefined` (the route stripping the consumed
 * param) leaves the selection alone.
 */
export function useSettingsShell({
  sections,
  initialSectionId,
}: ISettingsShellProps): ISettingsShellView {
  const [activeId, setActiveId] = useState<string | null>(initialSectionId ?? null);
  const [requestedId, setRequestedId] = useState(initialSectionId);

  if (initialSectionId !== requestedId) {
    setRequestedId(initialSectionId);
    if (initialSectionId !== undefined) setActiveId(initialSectionId);
  }

  const active = sections.find((section) => section.id === activeId) ?? sections[0];

  return { active, onSelect: setActiveId };
}
