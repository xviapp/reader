const { getDefaultConfig } = require('expo/metro-config');
const { isAbsolute, relative, resolve, sep } = require('node:path');

const config = getDefaultConfig(__dirname);
const sourceRoot = resolve(__dirname, 'src');

// Local TypeScript sources can use Node ESM's .js import spelling.
// Preserve normal Metro resolution first, including real JavaScript files.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    const target = resolve(context.originModulePath, '..', moduleName);
    const localPath = relative(sourceRoot, target);
    const isLocalSource = !isAbsolute(localPath)
      && localPath !== '..' && !localPath.startsWith(`..${sep}`);
    if (error.constructor.name !== 'FailedToResolvePathError'
      || !/^\.{1,2}\//.test(moduleName) || !moduleName.endsWith('.js')
      || !isLocalSource) {
      throw error;
    }
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
};

module.exports = config;
