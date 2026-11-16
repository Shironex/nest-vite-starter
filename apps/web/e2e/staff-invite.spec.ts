import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { ADMIN_STORAGE_STATE } from './support/auth';
import { MAILPIT_URL } from './support/mail';

/**
 * A colleague joining an existing organization.
 *
 * An ADMIN invites an address, the api really mails a link, and the link really
 * leads to a usable set-password screen. That chain crosses the queue and the
 * mail catcher, so nothing below the browser can prove it: the token is hashed
 * at rest and no procedure returns it, which makes following the mail the only
 * automated proof that an invited colleague receives something that works.
 *
 * ## Where this journey stops, and why
 *
 * It does NOT set the password and log in as the invitee, and that is a
 * deliberate limit rather than an oversight.
 *
 * Acceptance is one-way. `StaffInviteService` refuses to re-invite an account
 * that already has a password, so a journey that accepted would pass exactly
 * once and be refused on every run afterwards, against a database that is not
 * reset between local runs.
 *
 * The pre-check on `/auth/invite/$token` deliberately does NOT consume the
 * token, so stopping at the form leaves the invitation live and this spec
 * repeatable forever.
 *
 * What is therefore NOT covered here, and is covered by unit and integration
 * specs instead: the acceptance transaction, the collision move, and the
 * role-appropriate nav an accepted USER lands on. Those want a journey that can
 * mint a fresh address per run, which is a separate piece of work.
 *
 * Prereqs: docker services (mailpit included) + dev servers running.
 */

/** `StaffInviteService` mints `${APP_URL}/auth/invite/${rawToken}`. */
const INVITE_LINK = /\/auth\/invite\/[a-f0-9]{32,}/;

/**
 * The address this journey invites, every run.
 *
 * Fixed rather than unique-per-run, and never accepted, so each run re-invites
 * the SAME un-accepted row: a fresh token replaces the old one, which is the
 * supported resend path. A unique address per run would leave a new pending
 * member in the members list on every execution.
 */
const INVITEE = 'e2e-staff-invited@example.com';

test.describe('Staff invitations', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test.setTimeout(120_000);

  test('an admin invites a colleague, who receives a link to a usable form', async ({
    page,
    browser,
    request,
  }) => {
    await page.goto('/settings');
    // The settings screen is a rail of panels and opens on Profile, so the
    // members panel has to be selected rather than deep-linked.
    await page.getByRole('button', { name: 'Members' }).click();

    const members = page.locator('[data-slot="admin-members-section"]');
    await expect(members).toBeVisible();

    /* -------------------------------------------------------- the invite */
    const sentAt = Date.now();
    await members.getByRole('button', { name: 'Invite someone' }).click();

    const dialog = page.locator('[data-slot="invite-member-dialog"]');
    await expect(dialog).toBeVisible();

    /*
     * The default role is asserted before anything is typed. Inviting somebody
     * is granting them an organization's whole tenant-scoped read surface, so the form
     * has to open on the NARROWER of the two roles: an admin is then always a
     * deliberate click rather than the path of least resistance.
     */
    await expect(dialog.getByRole('radio', { name: 'User' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Administrator' })).not.toBeChecked();

    await dialog.getByLabel('Email address').fill(INVITEE);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog).toBeHidden();

    /* ------------------------------------------------- the pending member */
    /*
     * The row appears in the list immediately, marked as invited rather than
     * active. Before this feature every row in this table was somebody who
     * could sign in, so the distinction has to be VISIBLE or an admin cannot
     * tell who is actually working here.
     */
    const row = members.locator('tr', { hasText: INVITEE });
    await expect(row).toBeVisible();
    await expect(row.getByText('Invited', { exact: true })).toBeVisible();

    // A pending row can only be withdrawn: it has never signed in, so it has no
    // lockout to clear, no second factor to reset and no membership to end.
    await row.getByRole('button', { name: `Actions for ${INVITEE}` }).press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Withdraw invitation' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reset two-factor' })).toBeHidden();
    await expect(page.getByRole('menuitem', { name: 'Remove from organization' })).toBeHidden();
    await page.keyboard.press('Escape');

    /* ------------------------------------------------------- the real mail */
    const inviteUrl = await inviteLinkFromMail(request, INVITEE, sentAt);

    /*
     * A clean context, because the link's reader is not the admin who sent it.
     * Reusing this page's storage state would prove only that a signed-in
     * admin can open the URL, which is not what an invitation is for.
     */
    const inviteeContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    try {
      const invitee = await inviteeContext.newPage();
      await invitee.goto(inviteUrl);

      await expect(invitee.getByLabel('Password')).toBeVisible();
      await expect(invitee.getByRole('button', { name: 'Set password' })).toBeVisible();

      // No 2FA field: this account is brand new and cannot hold a factor. The
      // field exists for the collision path, where an EXISTING account accepts.
      await expect(invitee.getByLabel('Two-factor code')).toBeHidden();

      // Nor the move warning: nothing is being moved, so saying so would be a
      // sentence about somebody else's account.
      await expect(invitee.getByText(/closes the organization/)).toBeHidden();

      // Acceptance mints no session, so the screen says the next step is a
      // normal sign-in rather than dropping them into the app.
      await expect(invitee.getByText(/we will take you to sign in/)).toBeVisible();
    } finally {
      await inviteeContext.close();
    }
  });
});

/**
 * The invitation link the api actually mailed, from the local mail catcher.
 *
 * Polled rather than read once: mail rides the email-delivery queue, so the
 * mutation returning is the enqueue and not the delivery. `sentAt` discards
 * anything older than this run, so the token from a previous run cannot be
 * mistaken for this one's.
 */
async function inviteLinkFromMail(
  request: APIRequestContext,
  address: string,
  sentAt: number,
): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`);
        if (!response.ok()) return '';
        const body = (await response.json()) as {
          messages?: { ID: string; Created: string; To?: { Address: string }[] }[];
        };
        const message = (body.messages ?? []).find(
          (candidate) =>
            Date.parse(candidate.Created) >= sentAt - 1_000 &&
            (candidate.To ?? []).some((to) => to.Address.toLowerCase() === address),
        );
        if (message === undefined) return '';

        const detail = await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`);
        if (!detail.ok()) return '';
        const parsed = (await detail.json()) as { Text?: string; HTML?: string };
        const found = INVITE_LINK.exec(`${parsed.Text ?? ''}\n${parsed.HTML ?? ''}`);
        link = found === null ? '' : found[0];
        return link;
      },
      {
        message: `no staff invite mail reached ${address}`,
        timeout: 30_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .toMatch(INVITE_LINK);
  return link;
}
