import { Section, Text } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface TwoFactorAdminResetEmailProps {
  appName: string;
}

export function TwoFactorAdminResetEmail({ appName }: TwoFactorAdminResetEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          An administrator reset the two-factor authentication on your {appName} account.
        </Text>
        <Text style={paragraph}>
          You will be asked to set it up again at your next sign-in. No other changes were made to
          your account.
        </Text>
        <Text style={warning}>
          If you were not expecting this, contact your administrator to confirm the reset was
          intentional.
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

TwoFactorAdminResetEmail.PreviewProps = {
  appName: 'Nest Vite Starter',
} satisfies TwoFactorAdminResetEmailProps;

export default TwoFactorAdminResetEmail;
