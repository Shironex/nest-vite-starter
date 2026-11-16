/** English copy for this feature. Interpolated entries are small functions. */
export const dashboardStrings = {
  greeting: {
    title: ({ name }: { name: string }) => `Good day, ${name}`,
    subtitle: 'Here is what is happening in your account today.',
    fallbackName: 'there',
  },
  startHere: {
    title: 'Start here',
    description: 'This dashboard is empty on purpose: it is where your product begins.',
    steps: [
      'Add an api module under apps/api/src/modules, behind a thin tRPC router.',
      'Add a web feature under apps/web/src/features and a route under apps/web/src/routes.',
      'Replace this card with the first panel your users need.',
    ],
    securityLink: 'Turn on two-factor sign-in',
  },
} as const;
