import { Section, Text, Button, Link } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface TwoFactorEnforcementReminderEmailProps {
  appName: string;
  settingsUrl: string;
  /** Human-readable grace deadline, formatted by the producer. */
  deadline: string;
}

export function TwoFactorEnforcementReminderEmail({
  appName,
  settingsUrl,
  deadline,
}: TwoFactorEnforcementReminderEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          Reminder: two-factor authentication becomes required on your {appName} account on{' '}
          {deadline}.
        </Text>
        <Text style={note}>
          Set it up now to avoid losing access when the requirement takes effect.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={settingsUrl}>
            Set up two-factor authentication
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

const note: React.CSSProperties = {
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

TwoFactorEnforcementReminderEmail.PreviewProps = {
  appName: 'SaaS Starter',
  settingsUrl: 'https://example.com/settings/security',
  deadline: 'August 1, 2026',
} satisfies TwoFactorEnforcementReminderEmailProps;

export default TwoFactorEnforcementReminderEmail;
