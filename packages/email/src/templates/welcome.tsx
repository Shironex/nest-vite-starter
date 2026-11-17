import { Section, Text, Button } from 'react-email';
import { EmailLayout } from '../components/layout.js';

export interface WelcomeEmailProps {
  appName: string;
  loginUrl: string;
}

export function WelcomeEmail({ appName, loginUrl }: WelcomeEmailProps) {
  return (
    <EmailLayout appName={appName}>
      <Section>
        <Text style={paragraph}>Your email has been verified! Welcome to {appName}.</Text>
        <Text style={paragraph}>
          Your account is now fully active. You can start using all features right away.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={loginUrl}>
            Go to {appName}
          </Button>
        </Section>
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

WelcomeEmail.PreviewProps = {
  appName: 'Nest Vite Starter',
  loginUrl: 'https://example.com/login',
} satisfies WelcomeEmailProps;

export default WelcomeEmail;
