import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface TwoFactorDisabledEmailProps {
  appName: string;
  settingsUrl: string;
}

export function TwoFactorDisabledEmail({ appName, settingsUrl }: TwoFactorDisabledEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          Two-factor authentication was turned off on your {appName} account. Trusted devices were
          also forgotten, so every device will need to sign in fresh.
        </Text>
        <Text style={warning}>
          If this wasn&apos;t you, secure your account now: change your password and turn two-factor
          authentication back on.
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

TwoFactorDisabledEmail.PreviewProps = {
  appName: 'Nest Vite Starter',
  settingsUrl: 'https://example.com/settings/security',
} satisfies TwoFactorDisabledEmailProps;

export default TwoFactorDisabledEmail;
