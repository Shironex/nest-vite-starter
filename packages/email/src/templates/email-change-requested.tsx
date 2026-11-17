import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface EmailChangeRequestedEmailProps {
  appName: string;
  /** The address the account is moving TO, shown so the reader can judge it. */
  newEmail: string;
  settingsUrl: string;
}

/**
 * The email-change tripwire, sent to the OLD address the moment a change is
 * requested: the one mailbox guaranteed to still belong to the legitimate
 * owner. Same shape as the other security notices: what happened, and one red
 * box saying what to do if it wasn't you. Deliberately sent at REQUEST time, not
 * after confirmation, so the owner gets the whole confirmation-link window to
 * react.
 */
export function EmailChangeRequestedEmail({
  appName,
  newEmail,
  settingsUrl,
}: EmailChangeRequestedEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          A request was just made to change the sign-in email of your {appName} account to{' '}
          <strong>{newEmail}</strong>. The change only takes effect after that address confirms it;
          until then this address remains your sign-in email.
        </Text>
        <Text style={warning}>
          If this wasn&apos;t you, someone else may have access to your account. Change your
          password now: doing so cancels the pending email change and signs out every other session.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={settingsUrl}>
            Review security settings
          </Button>
        </Section>
        <Text style={fallback}>
          If the button doesn&apos;t work, copy and paste this link into your browser:{' '}
          <Link href={settingsUrl} style={link}>
            {settingsUrl}
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

const warning: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#dc2626',
  backgroundColor: '#fef2f2',
  padding: '12px 16px',
  borderRadius: '6px',
  border: '1px solid #fecaca',
  margin: '0 0 24px',
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

EmailChangeRequestedEmail.PreviewProps = {
  appName: 'Nest Vite Starter',
  newEmail: 'new-address@example.com',
  settingsUrl: 'https://example.com/settings',
} satisfies EmailChangeRequestedEmailProps;

export default EmailChangeRequestedEmail;
