/** English copy for this feature. Interpolated entries are small functions. */
export const dashboardStrings = {
  greeting: {
    title: ({ name }: { name: string }) => `Good day, ${name}`,
    subtitle: 'Here is what is happening in your organization today.',
    fallbackName: 'there',
  },
} as const;
