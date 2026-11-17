module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // One scope per app and package, plus the cross-cutting areas.
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'web',
        'ui',
        'shared',
        'database',
        'email',
        'eslint-config',
        'tsconfig',
        'config',
        'deps',
        'ci',
        'docs',
        'auth',
        'audit',
        'observability',
      ],
    ],
    'scope-empty': [1, 'never'],
  },
};
