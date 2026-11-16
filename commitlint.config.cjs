module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'web',
        'desktop',
        'ui',
        'shared',
        'database',
        'email',
        'config',
        'deps',
        'auth',
        'audit',
        'observability',
        'docs',
      ],
    ],
    'scope-empty': [1, 'never'],
  },
};
