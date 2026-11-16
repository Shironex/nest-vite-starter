/**
 * electron-builder config. A `.cjs` file because electron-builder 26 finds
 * `electron-builder.{yml,json,js,cjs,ts}` on its own but not `.mjs`, and a
 * config it cannot find is silently replaced by defaults.
 *
 * It is a function so the S3 update feed comes from the environment when the
 * build runs: see scripts/update-publish.mjs for which builds may omit it.
 *
 * @returns {Promise<import('electron-builder').Configuration>}
 */
module.exports = async () => {
  const { resolvePublishConfig } = await import('./scripts/update-publish.mjs');

  return {
    appId: 'com.example.saasstarter',
    productName: 'SaaS Starter',
    directories: {
      output: 'release',
      buildResources: 'resources',
    },
    files: ['dist/**/*', '!dist/api', '!dist/.env', 'package.json'],
    extraMetadata: {
      main: 'dist/main/index.js',
    },
    generateUpdatesFilesForAllChannels: true,
    publish: resolvePublishConfig({ env: process.env, argv: process.argv }),
    mac: {
      category: 'public.app-category.productivity',
      icon: 'resources/icon.png',
      target: ['dmg', 'zip'],
      hardenedRuntime: true,
      gatekeeperAssess: false,
      identity: null,
    },
    dmg: {
      sign: false,
    },
    win: {
      icon: 'resources/icon.ico',
      target: ['nsis'],
      signtoolOptions: {
        signingHashAlgorithms: null,
        sign: null,
      },
    },
    linux: {
      icon: 'resources/icon.png',
      target: ['AppImage'],
      category: 'Utility',
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
    },
    electronFuses: {
      enableNodeCliInspectArguments: false,
      enableNodeOptionsEnvironmentVariable: false,
      onlyLoadAppFromAsar: true,
      runAsNode: false,
      enableCookieEncryption: true,
      grantFileProtocolExtraPrivileges: false,
    },
  };
};
