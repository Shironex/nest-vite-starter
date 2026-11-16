import { Section, Text } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface TwoFactorSupportResetContestEmailProps {
  appName: string;
  ticketRef: string;
  /** Human-readable contest deadline, formatted by the producer. */
  contestDeadline: string;
}

export function TwoFactorSupportResetContestEmail({
  appName,
  ticketRef,
  contestDeadline,
}: TwoFactorSupportResetContestEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>
          We received a support request to reset the two-factor authentication on your {appName}{' '}
          account (ref {ticketRef}).
        </Text>
        <Text style={note}>
          If you asked for this, no action is needed and the reset will proceed.
        </Text>
        <Text style={warning}>
          If you did NOT request this, contact support before {contestDeadline} to stop it. After
          that time the reset may be completed.
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

TwoFactorSupportResetContestEmail.PreviewProps = {
  appName: 'SaaS Starter',
  ticketRef: 'SUP-10432',
  contestDeadline: 'August 1, 2026',
} satisfies TwoFactorSupportResetContestEmailProps;

export default TwoFactorSupportResetContestEmail;
