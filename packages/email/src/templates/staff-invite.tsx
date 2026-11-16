import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface StaffInviteEmailProps {
  /** Single-use invite link carrying the raw STAFF_INVITE token. */
  inviteUrl: string;
  appName: string;
  /** The organization the recipient is being invited into. */
  organizationName: string;
  /**
   * Who sent the invitation, as the members list shows them. Optional because
   * an organization account need not have a display name, and "someone at this organization
   * invited you" is still a true and useful sentence.
   */
  inviterName?: string | undefined;
  /**
   * Human copy for the link lifetime ("7 days"). The api passes it from the
   * shared STAFF_INVITE_TOKEN_TTL_MS so the prose follows the real TTL; the
   * default keeps standalone renders (previews, tests) unchanged.
   */
  expiresIn?: string | undefined;
}

/**
 * The invitation to join an existing organization.
 *
 * Names the ORGANIZATION and the person who invited them: this reader is about to
 * become a member of that tenant. Being able to see who invited them
 is also the only check they
 * have against an invitation they were not expecting.
 *
 * Carries no personal data beyond the inviter's display name and the organization's,
 * both of which the recipient is about to work alongside.
 */
export function StaffInviteEmail({
  inviteUrl,
  appName,
  organizationName,
  inviterName,
  expiresIn = '7 days',
}: StaffInviteEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          {inviterName
            ? `${inviterName} invited you to join ${organizationName} on ${appName}.`
            : `You have been invited to join ${organizationName} on ${appName}.`}
        </Text>
        <Text style={paragraph}>
          To get started, set a password for your account. Until you do, the account has no password
          and nobody can sign in to it.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={inviteUrl}>
            Set password
          </Button>
        </Section>
        <Text style={note}>
          This link expires in {expiresIn} and works only once. If it expires, ask the person who
          invited you for a new invitation. If you were not expecting this email, ignore it: without
          a password the account stays inactive.
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

StaffInviteEmail.PreviewProps = {
  appName: 'SaaS Starter',
  inviteUrl: 'https://example.com/auth/invite/preview-token',
  organizationName: 'Acme Consulting',
  inviterName: 'Jane Doe',
  expiresIn: '7 days',
} satisfies StaffInviteEmailProps;

export default StaffInviteEmail;
