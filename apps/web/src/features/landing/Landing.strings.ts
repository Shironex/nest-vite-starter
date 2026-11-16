/** English copy for this feature. Interpolated entries are small functions. */
export const landingStrings = {
  nav: {
    label: 'Main',
    signIn: 'Sign in',
    createAccount: 'Create account',
  },
  hero: {
    lead: 'A NestJS and Vite starter with accounts, two-factor sign-in, an admin page and a typed API already in place. Start on the part only you can build.',
    createAccount: 'Create an account',
    signIn: 'Sign in',
  },
  footer: {
    copyright: ({ year, productName }: { year: number; productName: string }) =>
      `© ${year} ${productName}`,
  },
} as const;
