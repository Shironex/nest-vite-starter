import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Bell, CircleHelp, Download, Palette, Shield, User, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ROLES } from '@repo/shared/permissions';
import { pageTitle } from '@/lib/page-title';
import { useAuth } from '@/hooks/use-auth';
import { useSetTopbarSubtitle } from '@/stores/topbar-store';
import { ProfileSection } from '@/features/settings/components/ProfileSection';
import { DataExportSection } from '@/features/settings/components/DataExportSection';
import { PasswordSection } from '@/features/settings/components/PasswordSection';
import { SessionsSection } from '@/features/settings/components/SessionsSection';
import { DangerZoneSection } from '@/features/settings/components/DangerZoneSection';
import { SettingsShell } from '@/features/settings/components/SettingsShell';
import type { ISettingsSection } from '@/features/settings/components/SettingsShell';
import { SecurityCard } from '@/features/two-factor/components/SecurityCard';
import { OrgTwoFactorPolicyCard } from '@/features/two-factor/components/OrgTwoFactorPolicyCard';
import { MembersSection } from '@/features/admin/components/MembersSection';
import { NotificationsSection } from '@/features/settings/components/NotificationsSection';
import { ThemeSection } from '@/features/settings/components/ThemeSection';
import { ConnectedAccountsSection } from '@/features/auth/components/ConnectedAccountsSection';
import { EmailChangeSection } from '@/features/auth/components/EmailChangeSection';
import { isOAuthProviderKey } from '@/features/auth/Auth.constants';
import { SETTINGS_SECTION } from '@/features/settings/Settings.constants';
import { isSettingsSectionId } from '@/features/settings/Settings.util';
import type { SettingsSectionId } from '@/features/settings/Settings.constants';
import type { OAuthProviderKey } from '@/features/auth/Auth.constants';
import { IS_ELECTRON } from '@/lib/electron';
import { UpdatesSection } from '@/features/settings/components/UpdatesSection';
import { HelpToursSection } from '@/features/help/components/HelpToursSection';

export const Route = createFileRoute('/_authenticated/settings/')({
  head: () => pageTitle('pageTitle.settings'),
  /**
   * A successful OAuth link comes back as a 302 to
   * `/settings?oauth_linked=<provider>` (OAUTH_LINKED_PARAM in the api's
   * oauth.constants.ts). ConnectedAccountsSection announces it and strips it.
   * Same discipline as the `/auth` layout's `error` param: a total function,
   * no schema parse, and any value outside the known provider keys is dropped
   * rather than echoed.
   *
   * `?section=<id>` deep links to one rail row (the two-factor grace banner
   * sends the user to `security`). Same discipline: only an id from
   * SETTINGS_SECTION survives, anything else is dropped. The page consumes it
   * and strips it again, see SettingsPage.
   */
  validateSearch: (
    search: Record<string, unknown>,
  ): { oauth_linked?: OAuthProviderKey; section?: SettingsSectionId } => ({
    ...(isOAuthProviderKey(search.oauth_linked) ? { oauth_linked: search.oauth_linked } : {}),
    ...(isSettingsSectionId(search.section) ? { section: search.section } : {}),
  }),
  component: SettingsPage,
});

/**
 * `/settings`, composed onto the rail from the design.
 *
 * THE RAIL SHIPS FIVE OF THE DESIGN'S SEVEN ROWS. The mockup lists Profile,
 * Organization, Users, Notifications, Security, Billing and Integrations.
 * Organization (organization master data), Billing and Integrations
 * (third-party integrations) have no procedure, no
 * schema and no code behind them, so they are absent rather than
 * present-and-empty. A rail row that opens onto a placeholder is a promise
 * the app cannot keep, which is the same reason `DashboardPage` renders one
 * stat tile instead of four.
 *
 * TWO ROWS THE DESIGN DOES NOT DRAW ARE HERE ANYWAY. `Appearance` and
 * `Updates` are real shipped functionality the mockup never covered, the
 * mirror of the case `Layout.nav.ts` documents for the compliance calendar:
 * absent from the design, present in the product, so it gets an entry.
 *
 * The composition lives in the route and not in `SettingsShell` because the
 * panels are spread across three features and `no-cross-feature-imports` blocks
 * a feature from reaching into another one. Routes are outside that rule.
 *
 * There is no `<h1>` here. The app shell's topbar renders the page title for
 * every route and that line IS the document `<h1>`, so a page-level heading
 * would be a second one competing with it.
 */
function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { oauth_linked, section } = Route.useSearch();
  const navigate = useNavigate();
  const isAdmin = user?.role === ROLES.ADMIN;

  // The design puts the strapline under the page TITLE, in the shell topbar,
  // not in the page body. The shell owns that row, so the page publishes into it.
  useSetTopbarSubtitle(t('settings.subtitle'));

  const sections: ISettingsSection[] = [
    {
      id: SETTINGS_SECTION.profile,
      label: t('settings.sections.profile'),
      icon: User,
      // The GDPR export sits with the profile it exports.
      panel: (
        <>
          <ProfileSection />
          <EmailChangeSection />
          <DataExportSection />
        </>
      ),
    },
    {
      id: SETTINGS_SECTION.notifications,
      label: t('settings.sections.notifications'),
      icon: Bell,
      panel: <NotificationsSection />,
    },
    {
      id: SETTINGS_SECTION.security,
      label: t('settings.sections.security'),
      icon: Shield,
      panel: (
        <>
          <PasswordSection />
          <SecurityCard />
          <SessionsSection />
          <ConnectedAccountsSection />
          <DangerZoneSection />
        </>
      ),
    },
    {
      id: SETTINGS_SECTION.appearance,
      label: t('settings.sections.appearance'),
      icon: Palette,
      panel: <ThemeSection />,
    },
    /*
     * A THIRD ROW THE DESIGN DOES NOT DRAW, on the same terms as Appearance and
     * Updates above: real shipped functionality the mockup never covered.
     *
     * It is a rail row rather than a panel under Profile because it is not about
     * this account at all; it is the index of every guided tour in the
     * product, and the one place somebody who cannot remember which screen
     * explained a thing can go and find it.
     */
    {
      id: SETTINGS_SECTION.help,
      label: t('settings.sections.help'),
      icon: CircleHelp,
      panel: <HelpToursSection />,
    },
  ];

  /*
   * Admin-only, and hiding it is a courtesy rather than the control: every
   * procedure behind these panels carries AdminMiddleware and the server
   * refuses regardless of what the rail shows.
   */
  if (isAdmin) {
    sections.splice(1, 0, {
      id: SETTINGS_SECTION.members,
      label: t('settings.sections.members'),
      icon: Users,
      panel: (
        <>
          <OrgTwoFactorPolicyCard />
          <MembersSection />
        </>
      ),
    });
  }

  // The updater only exists in the desktop shell; in the browser there is
  // nothing for this row to manage.
  if (IS_ELECTRON) {
    sections.push({
      id: SETTINGS_SECTION.updates,
      label: t('settings.sections.updates'),
      icon: Download,
      panel: <UpdatesSection />,
    });
  }

  // The link callback must land the user ON the announcing panel:
  // ConnectedAccountsSection only mounts while the security section is
  // selected, and it is the one that reads and strips `oauth_linked`. That is
  // why it wins over `section`: sending the user anywhere else would leave the
  // link unannounced and the param stuck in the URL.
  const initialSectionId = oauth_linked !== undefined ? SETTINGS_SECTION.security : section;

  /*
   * `section` is a one-shot request, not the rail's state: the shell adopts it
   * when it changes and the rail stays local state after that. Stripping it
   * once consumed is what makes the NEXT request a change. The grace banner is
   * shown on this page too, so without the strip a second click on its CTA
   * (after the user moved to another row) would navigate to the URL already
   * on screen and do nothing. `replace` keeps Back from resurrecting it.
   * With `oauth_linked` present ConnectedAccountsSection clears the whole
   * search itself, so this stands aside rather than race it.
   */
  useEffect(() => {
    if (section === undefined || oauth_linked !== undefined) return;
    void navigate({ to: '/settings', search: {}, replace: true });
  }, [section, oauth_linked, navigate]);

  return <SettingsShell sections={sections} initialSectionId={initialSectionId} />;
}
