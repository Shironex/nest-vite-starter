import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface VerificationEmailProps {
  verificationUrl: string;
  appName: string;
  /**
   * Human copy for the link lifetime ("24 hours"). The api passes it from the
   * shared VERIFICATION_TOKEN_TTL_MS so the prose follows the real TTL; the
   * default keeps standalone renders (previews, tests) unchanged. Explicit
   * `| undefined` so exactOptionalPropertyTypes consumers can pass a parsed
   * optional through.
   */
  expiresIn?: string | undefined;
}

export function VerificationEmail({
  verificationUrl,
  appName,
  expiresIn = '24 hours',
}: VerificationEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          Welcome to {appName}! Please verify your email address to get started.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={verificationUrl}>
            Verify Email Address
          </Button>
        </Section>
        <Text style={note}>This link expires in {expiresIn}.</Text>
        {/* Anyone can register with an address they do not own, so the
            owner must be told that a mail they did not ask for is safe to
            ignore, and that the link should then stay unclicked. */}
        <Text style={note}>
          Didn&apos;t create a {appName} account? Someone may have typed your address by mistake.
          Ignore this email and don&apos;t click the link: the address stays unverified.
        </Text>
        <Text style={fallback}>
          If the button doesn&apos;t work, copy and paste this link into your browser:{' '}
          <Link href={verificationUrl} style={link}>
            {verificationUrl}
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

VerificationEmail.PreviewProps = {
  appName: 'SaaS Starter',
  verificationUrl: 'https://example.com/verify-email?token=preview-token',
  expiresIn: '24 hours',
} satisfies VerificationEmailProps;

export default VerificationEmail;
