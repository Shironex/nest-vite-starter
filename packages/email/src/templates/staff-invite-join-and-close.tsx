import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface StaffInviteJoinAndCloseEmailProps {
  /** Single-use invite link carrying the raw STAFF_INVITE token. */
  inviteUrl: string;
  appName: string;
  /** The organization the recipient is being invited into. */
  organizationName: string;
  /** Who sent the invitation, as the members list shows them. */
  inviterName?: string | undefined;
  /** Human copy for the link lifetime ("7 days"), from STAFF_INVITE_TOKEN_TTL_MS. */
  expiresIn?: string | undefined;
}

/**
 * The invitation sent when the address ALREADY has an account somewhere else
 *.
 *
 * A REQUIREMENT, not a nicety, and a separate template rather than a paragraph
 * toggled on inside the ordinary one. Accepting on this path moves the reader's
 * account into another organization and closes the organization they are in today.
 * An invitation that changes account ownership without saying so is a phishing
 * template we wrote ourselves, and the reasoning that put a tripwire mail on
 * OAuth auto-linking applies here with more force: there, a second identity was
 * attached to an account; here, the account itself changes hands.
 *
 * The warning therefore sits ABOVE the button and in its own emphasized block,
 * because a consequence disclosed after the call to action is not disclosed.
 *
 * What it deliberately does NOT say: whether the reader's current organization is
 * empty, what is in it, or anything about the other organization. Those are
 * answers only the acceptance screen may give, and only to someone who has
 * proved they hold the account.
 */
export function StaffInviteJoinAndCloseEmail({
  inviteUrl,
  appName,
  organizationName,
  inviterName,
  expiresIn = '7 days',
}: StaffInviteJoinAndCloseEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          {inviterName
            ? `${inviterName} invited you to join ${organizationName} on ${appName}.`
            : `You have been invited to join ${organizationName} on ${appName}.`}
        </Text>
        <Text style={paragraph}>
          This address already has an account on {appName}, so the invitation is for that same
          account.
        </Text>
        <Section style={warningBox}>
          <Text style={warningText}>
            Before you click: accepting the invitation moves your account into {organizationName}{' '}
            and closes the organization you are in now. You will sign in with the same address and
            the same password, but you will see the new organization&apos;s data. You cannot undo
            this change yourself.
          </Text>
        </Section>
        <Text style={paragraph}>
          If you agree, click below and set the password for your account in the new organization.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={inviteUrl}>
            Move account and set password
          </Button>
        </Section>
        <Text style={note}>
          This link expires in {expiresIn} and works only once. If you do not want to move your
          account, simply ignore this email: nothing changes until you click. If you were not
          expecting this invitation, ignore it and change your account password.
        </Text>
        <Text style={fallback}>
          If the button doesn&apos;t work, copy and paste this link into your browser:{' '}
          <Link href={inviteUrl} style={link}>
            {inviteUrl}
          </Link>
        </Text>
      </Section>
    </EmailLayout>
  );
}

const paragraph: React.CSSProperties = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#374151',
  margin: '0 0 16px',
};

const warningBox: React.CSSProperties = {
  backgroundColor: '#fef3c7',
  borderLeft: '4px solid #d97706',
  borderRadius: '4px',
  padding: '12px 16px',
  margin: '0 0 16px',
};

const warningText: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '24px',
  color: '#78350f',
  margin: '0',
  fontWeight: '600',
};

const buttonContainer: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button: React.CSSProperties = {
  backgroundColor: '#7c3aed',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  padding: '12px 24px',
  borderRadius: '6px',
  display: 'inline-block',
};

const note: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  lineHeight: '22px',
  margin: '0 0 16px',
};

const fallback: React.CSSProperties = {
  fontSize: '13px',
  color: '#9ca3af',
  lineHeight: '20px',
  margin: '0',
  wordBreak: 'break-all' as const,
};

const link: React.CSSProperties = {
  color: '#7c3aed',
  textDecoration: 'underline',
};

StaffInviteJoinAndCloseEmail.PreviewProps = {
  appName: 'SaaS Starter',
  inviteUrl: 'https://example.com/auth/invite/preview-token',
  organizationName: 'Acme Consulting',
  inviterName: 'Jane Doe',
  expiresIn: '7 days',
} satisfies StaffInviteJoinAndCloseEmailProps;

export default StaffInviteJoinAndCloseEmail;
