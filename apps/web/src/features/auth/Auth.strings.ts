/** English copy for this feature. Interpolated entries are small functions. */
export const authStrings = {
  layout: {
    backToHome: 'Back to the home page',
  },
  backToSignIn: 'Back to sign in',
  fields: {
    email: 'Email address',
    emailPlaceholder: 'anna@example.com',
    password: 'Password',
    newPasswordPlaceholder: 'At least 8 characters',
  },
  login: {
    forgotPassword: 'Forgot password?',
    rememberMe: 'Keep me signed in',
    submit: 'Sign in',
    accountLocked:
      'Your account has been temporarily locked due to too many failed login attempts. Please try again later.',
    captchaFailed: 'CAPTCHA verification failed. Please try again.',
  },
  register: {
    workEmail: 'Work email address',
    displayName: 'Display name (optional)',
    displayNamePlaceholder: 'Jane Smith',
    submit: 'Create account',
    emailExists: 'An account with this email already exists.',
  },
  forgotPassword: {
    sent: 'If an account exists for this address, we will send it a link to set a new password. Check your inbox and your spam folder.',
    submit: 'Send reset link',
  },
  resetPassword: {
    tokenMissing:
      'Open the password reset link from your email. This address no longer contains a token.',
    requestNewLink: 'Request a new link',
    newPassword: 'New password',
    factorCode: 'Authenticator code or backup code',
    factorCodePlaceholder: '6-digit code or backup code',
    submit: 'Save and sign in',
    success: 'Password reset successfully. You can now sign in.',
    invalidLink: 'This reset link is invalid or has expired. Please request a new one.',
    codeIncorrect: 'That code was not correct',
  },
  verifyEmail: {
    verifyingTitle: 'Confirming your email address',
    verifyingDescription: 'This will only take a moment.',
    verifiedTitle: 'Email address confirmed',
    verifiedDescription:
      'Your email address has been verified. For your security we signed this account out on every device, so please sign in again.',
    signIn: 'Sign in',
    failedTitle: 'Verification failed',
    retry: 'Try again',
    resend: 'Resend the link',
    resent: 'The link has been sent again. Check your inbox.',
    sendFailedTitle: 'We could not send the email',
    sendFailedDescription:
      'Your account was created, but the email with the activation link did not arrive. Send it again below.',
    checkInboxTitle: 'Confirm your email address',
    checkInboxDescription:
      'We sent an activation link to your email address. Click it to finish creating your account.',
    invalidLink: 'This verification link is invalid or has expired.',
  },
  brandPanel: {
    headline: 'Everything your team needs, in one place.',
    subheadline: 'Sign in to pick up where you left off, or create an account in a minute.',
    trustCopy: 'Two-factor sign-in and an audit log protect every account.',
    scene: {
      summaryTitle: 'Security',
      summaryFirstLabel: 'Two-factor',
      summaryFirstValue: 'Enabled',
      summarySecondLabel: 'Audit log',
      summarySecondValue: 'Recording',
      personTitle: 'Onboarding',
      personInitials: 'YT',
      personName: 'Your team',
      status: 'Account ready',
    },
  },
  sudo: {
    title: 'Confirm your password',
    description:
      'This action needs you to confirm your password again. The confirmation stays valid for 5 minutes.',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter your password',
    invalidPassword: 'Password is incorrect.',
  },
  emailChange: {
    title: 'Email address',
    description:
      'Change the address you use to sign in. The new address must confirm the change before it takes effect.',
    currentLabel: 'Current address',
    newLabel: 'New email address',
    newPlaceholder: 'name@company.com',
    factorLabel: 'Two-factor authentication code',
    factorPlaceholder: 'Authenticator or recovery code',
    factorHint: 'Two-factor authentication is on, so the change also needs a current code.',
    submit: 'Change email address',
    pendingSent: ({ email }: { email: string }) =>
      `We sent a confirmation link to ${email}. The change takes effect once you open it. Afterwards you will be signed out and sign in with the new address.`,
    requestedToast: 'Confirmation link sent.',
    confirm: {
      loadingTitle: 'Confirming your new address',
      loadingDescription: 'This will only take a moment.',
      successTitle: 'Email address changed',
      successDescription:
        'You have been signed out everywhere for security. Sign in with your new address.',
      errorTitle: 'Confirmation failed',
      invalidLink:
        'This confirmation link is invalid or has expired. Request the change again from settings.',
      emailInUse:
        'This address has been taken in the meantime. Request the change again with a different address.',
      missingToken: 'This link is incomplete. Open the link from the confirmation email again.',
      retry: 'Try again',
      goToLogin: 'Go to sign in',
    },
  },
  captcha: {
    verifying: 'Running security check...',
    pendingHint: 'We are checking that you are not a robot. This takes a moment.',
    failed: 'The security check failed. Refresh the page and try again.',
    expired: 'The security check expired. Wait for the widget to refresh, or reload the page.',
  },
  pages: {
    login: {
      title: 'Welcome back',
      noAccount: 'No account yet?',
      register: 'Create an account',
    },
    register: {
      title: 'Create an account',
      haveAccount: 'Already have an account?',
      signIn: 'Sign in',
    },
    forgotPassword: {
      title: 'Reset your password',
      description:
        "Enter your account's email address and we will send you a link to set a new password.",
    },
    resetPassword: {
      title: 'Set a new password',
      description: 'Choose a new password for your account.',
    },
  },
} as const;
