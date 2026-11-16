import { Section, Text } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface PasswordChangedEmailProps {
  appName: string;
}

export function PasswordChangedEmail({ appName }: PasswordChangedEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>Your password for {appName} has been successfully changed.</Text>
        <Text style={warning}>
          If you didn&apos;t make this change, please contact support immediately. Your account may
          have been compromised.
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
  margin: '0',
};

PasswordChangedEmail.PreviewProps = {
  appName: 'SaaS Starter',
} satisfies PasswordChangedEmailProps;

export default PasswordChangedEmail;
