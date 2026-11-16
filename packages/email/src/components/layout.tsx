import { Html, Head, Body, Container, Section, Text, Hr } from 'react-email';
import type { ReactNode } from 'react';

/**
 * Languages a template can be written in. English is the only one today;
 * adding a language is widening this union, which makes `DEFAULT_FOOTER` fail
 * to compile until the new footer sentence exists.
 */
export type EmailLang = 'en';

interface EmailLayoutProps {
  appName: string;
  /**
   * Language of the body this layout wraps.
   *
   * Drives `<Html lang>` (which is what a screen reader picks its voice from)
   * and the footer copy, so a template's body and footer are always the same
   * language. Defaults to `en`.
   */
  lang?: EmailLang;
  /** Overrides the default footer sentence for this template. */
  footer?: ReactNode;
  children: ReactNode;
}

/** Footer sentence per language, interpolating the product name. */
const DEFAULT_FOOTER: Record<EmailLang, (appName: string) => string> = {
  en: (appName) =>
    `This email was sent by ${appName}. If you didn't request this, you can safely ignore it.`,
};

export function EmailLayout({ appName, lang = 'en', footer, children }: EmailLayoutProps) {
  return (
    <Html lang={lang}>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={heading}>{appName}</Text>
          </Section>
          {children}
          <Hr style={hr} />
          <Section style={footerSection}>
            <Text style={footerText}>{footer ?? DEFAULT_FOOTER[lang](appName)}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: '0',
  padding: '0',
};

const container: React.CSSProperties = {
  maxWidth: '580px',
  margin: '40px auto',
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  padding: '40px',
  border: '1px solid #e5e7eb',
};

const header: React.CSSProperties = {
  textAlign: 'center' as const,
  marginBottom: '32px',
};

const heading: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: '700',
  color: '#7c3aed',
  margin: '0',
  letterSpacing: '-0.5px',
};

const hr: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '32px 0 24px',
};

const footerSection: React.CSSProperties = {
  textAlign: 'center' as const,
};

const footerText: React.CSSProperties = {
  fontSize: '13px',
  color: '#9ca3af',
  lineHeight: '20px',
  margin: '0',
};
