import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface EmailChangeVerificationEmailProps {
  /** Link that completes the change; mailed to the NEW address only. */
  confirmUrl: string;
  appName: string;
  /**
   * Human copy for the link lifetime ("1 hour"). The api passes it from the
   * shared EMAIL_CHANGE_TOKEN_TTL_MS so the prose follows the real TTL; the
   * default keeps standalone renders (previews, tests) unchanged. Explicit
   * `| undefined` so exactOptionalPropertyTypes consumers can pass a parsed
   * optional through.
   */
  expiresIn?: string | undefined;
}

/**
 * Sent to the address the account is moving TO. Clicking the link is what
 * proves control of the new mailbox; until then the old address stays the
 * login identity, so the copy is explicit that nothing has happened yet.
 */
export function EmailChangeVerificationEmail({
  confirmUrl,
  appName,
  expiresIn = '1 hour',
}: EmailChangeVerificationEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          A request was made to use this address as the sign-in email for a {appName} account.
          Confirm the change to make this mailbox the new sign-in address. Until you confirm,
          nothing changes and the current address keeps working.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={confirmUrl}>
            Confirm new email address
          </Button>
        </Section>
        <Text style={note}>
          This link expires in {expiresIn}. If you did not request this change, you can safely
          ignore this email.
        </Text>
        <Text style={fallback}>
          If the button doesn&apos;t work, copy and paste this link into your browser:{' '}
          <Link href={confirmUrl} style={link}>
            {confirmUrl}
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

EmailChangeVerificationEmail.PreviewProps = {
  appName: 'Nest Vite Starter',
  confirmUrl: 'https://example.com/auth/confirm-email-change?token=preview-token',
  expiresIn: '1 hour',
} satisfies EmailChangeVerificationEmailProps;

export default EmailChangeVerificationEmail;
