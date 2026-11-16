import { useTranslation } from 'react-i18next';
import { cn } from '@repo/ui/lib/utils';
import { useSettingsShell } from './SettingsShell.hooks';
import type { ISettingsSection, ISettingsShellProps } from './SettingsShell.types';

/**
 * The two-column settings shell from the design: a fixed rail on the left, the selected panel on the right.
 *
 * PORTABLE NUMBERS ONLY. The mockup is drawn at playground scale (2172px
 * inputs), so its proportions do not transfer. What does transfer is the 300px
 * rail and the row rhythm: 38px rows on a 42px pitch, which is `h-9.5` plus a
 * 4px gap. The content column is capped at the width the security panel is
 * actually drawn to (760px) rather than at the playground width.
 *
 * A RAIL OF BUTTONS, NOT A TAB STRIP. Radix `Tabs` would supply arrow-key
 * roving focus, but its trigger carries `dark:data-[state=active]:*` color
 * overrides that outrank a consumer class in dark mode, so painting the design's
 * light-indigo pill on it would mean hand-authoring a dark counterpart for
 * every one of them. Plain buttons in a `<nav>` reuse the app sidebar's active
 * treatment directly, stay entirely on the token layer, and remain reachable
 * with Tab. Revisit if `@repo/ui` sheds those overrides (issue D08).
 */

/** 300px, per the design. Full width until there is room for two columns. */
const RAIL_CLASS = 'w-full shrink-0 lg:w-[300px]';

/**
 * The same treatment `AppSidebar` gives its links, minus the sidebar
 * primitive's `data-active` plumbing: brand tint plus brand text when active,
 * a neutral hover fill when not, so hover never reads as selected.
 */
const ROW_BASE_CLASS =
  'flex h-9.5 w-full items-center gap-2.5 rounded-md px-2.5 text-left type-body-medium text-text-secondary transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none [&>svg]:size-4.5 [&>svg]:shrink-0';
const ROW_ACTIVE_CLASS =
  'bg-brand-50 type-body-strong text-brand-ink hover:bg-brand-50 hover:text-brand-ink';

function NavRow({
  section,
  isActive,
  onSelect,
}: {
  section: ISettingsSection;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-slot="settings-nav-row"
        aria-current={isActive ? 'true' : undefined}
        className={cn(ROW_BASE_CLASS, isActive && ROW_ACTIVE_CLASS)}
        onClick={() => onSelect(section.id)}
      >
        <section.icon aria-hidden="true" />
        <span className="truncate">{section.label}</span>
      </button>
    </li>
  );
}

export default function SettingsShell({ sections, initialSectionId }: ISettingsShellProps) {
  const { t } = useTranslation();
  const { active, onSelect } = useSettingsShell({ sections, initialSectionId });

  // Mapped here rather than in the returned markup: `no-jsx-computation` gates
  // the JSX, the same way `AppSidebar` builds its groups up front.
  const rows = sections.map((section) => (
    <NavRow
      key={section.id}
      section={section}
      isActive={section.id === active?.id}
      onSelect={onSelect}
    />
  ));

  if (!active) return null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8" data-slot="settings-shell">
      <nav aria-label={t('settings.nav')} className={RAIL_CLASS}>
        <p className="px-2.5 pb-1.5 type-label-overline text-text-tertiary">{t('settings.nav')}</p>
        <ul className="flex flex-col gap-1">{rows}</ul>
      </nav>

      {/*
        Keyed by the active id so switching rows remounts the panel instead of
        reconciling one section's form state into the next one's fields.
      */}
      <section
        key={active.id}
        aria-label={active.label}
        className="min-w-0 flex-1 space-y-4 lg:max-w-3xl"
      >
        {active.panel}
      </section>
    </div>
  );
}
