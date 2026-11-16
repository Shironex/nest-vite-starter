import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface OAuthAccountLinkedEmailProps {
  appName: string;
  /** Human-facing provider name, e.g. "Google". */
  providerName: string;
  settingsUrl: string;
  /**
   * Where a reader who did not link anything starts a password reset: a
   * reset replaces the password and ends every session, so it is the one step
   * that locks an intruder out. Optional so jobs enqueued before the field
   * existed still render; explicit `| undefined` for exactOptionalPropertyTypes.
   */
  resetPasswordUrl?: string | undefined;
}

/**
 * The account-linking tripwire: sent on EVERY new
 * sign-in method link, automatic or manual, so a silently-linked identity
 * cannot stay silent. Same shape as the recovery-code-used notice: what
 * happened, and one red box saying what to do if it wasn't you.
 */
export function OAuthAccountLinkedEmail({
  appName,
  providerName,
  settingsUrl,
  resetPasswordUrl,
}: OAuthAccountLinkedEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          A {providerName} account was just linked to your {appName} account as a new way to sign
          in. You can review or remove connected accounts in your security settings at any time.
        </Text>
        <Text style={warning}>
          If this wasn&apos;t you, secure your account now: reset your password, which signs out
          every device, then unlink the {providerName} account and review your active sessions.
          {resetPasswordUrl === undefined ? null : (
            <>
              {' '}
              <Link href={resetPasswordUrl} style={warningLink}>
                Reset your password
              </Link>
            </>
          )}
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={settingsUrl}>
            Review connected accounts
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

const warningLink: React.CSSProperties = {
  color: '#dc2626',
  fontWeight: '600',
  textDecoration: 'underline',
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

OAuthAccountLinkedEmail.PreviewProps = {
  appName: 'SaaS Starter',
  providerName: 'Google',
  settingsUrl: 'https://example.com/settings',
  resetPasswordUrl: 'https://example.com/auth/forgot-password',
} satisfies OAuthAccountLinkedEmailProps;

export default OAuthAccountLinkedEmail;
