// found this online, this fixes a bug where the program would crash when running on web, do not delete this

// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const ALIASES = {
  tslib: "tslib/tslib.es6.js",
};

// Fixes a warning from Expo's Metro bundler about the ESM build of Amplify being imported in a CJS context. 
// Does not affect the client bundle, only the SSR (node) bundle.
const AMPLIFY_PACKAGE = /^(@aws-amplify\/[^/]+|aws-amplify)(\/|$)/;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = ALIASES[moduleName] ?? moduleName;

  if (
    AMPLIFY_PACKAGE.test(name) &&
    context.customResolverOptions?.environment === "node"
  ) {
    return context.resolveRequest(
      { ...context, isESMImport: false },
      name,
      platform,
    );
  }

  return context.resolveRequest(context, name, platform);
};

module.exports = config;
