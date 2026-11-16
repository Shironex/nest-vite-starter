import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface PasswordResetEmailProps {
  resetUrl: string;
  appName: string;
  ipAddress: string;
  /**
   * Human copy for the link lifetime ("1 hour"). The api passes it from the
   * shared PASSWORD_RESET_TOKEN_TTL_MS so the prose follows the real TTL; the
   * default keeps standalone renders (previews, tests) unchanged. Explicit
   * `| undefined` so exactOptionalPropertyTypes consumers can pass a parsed
   * optional through.
   */
  expiresIn?: string | undefined;
}

export function PasswordResetEmail({
  resetUrl,
  appName,
  ipAddress,
  expiresIn = '1 hour',
}: PasswordResetEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          We received a request to reset your password for your {appName} account.
        </Text>
        <Text style={securityNote}>This request was made from IP: {ipAddress}</Text>
        <Section style={buttonContainer}>
          <Button style={button} href={resetUrl}>
            Reset Password
          </Button>
        </Section>
        <Text style={note}>
          This link expires in {expiresIn}. If you didn&apos;t request this, you can safely ignore
          this email. Your password will remain unchanged.
        </Text>
        <Text style={fallback}>
          If the button doesn&apos;t work, copy and paste this link into your browser:{' '}
          <Link href={resetUrl} style={link}>
            {resetUrl}
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

const securityNote: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#6b7280',
  backgroundColor: '#f9fafb',
  padding: '12px 16px',
  borderRadius: '6px',
  border: '1px solid #e5e7eb',
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

PasswordResetEmail.PreviewProps = {
  appName: 'SaaS Starter',
  resetUrl: 'https://example.com/reset-password?token=preview-token',
  ipAddress: '203.0.113.42',
  expiresIn: '1 hour',
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;
