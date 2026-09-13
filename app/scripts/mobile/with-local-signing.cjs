/* global __dirname */
const { withAppBuildGradle } = require('expo/config-plugins');
const path = require('node:path');

module.exports = (config) => withAppBuildGradle(config, (result) => {
  const directory = path.resolve(__dirname, '../../.native-release').replaceAll('\\', '/');
  if (/["'\n\r]/.test(directory)) throw new Error('Unsupported signing directory characters.');
  const signing = `signingConfigs {
        tcgRelease {
            storeFile file('${directory}/tcg-release.jks')
            storePassword new File('${directory}/signing-password').text.trim()
            keyAlias 'tcg-release'
            keyPassword new File('${directory}/signing-password').text.trim()
        }`;
  let source = result.modResults.contents;
  if (!source.includes('tcgRelease {')) source = source.replace('signingConfigs {', signing);
  source = source.replace(/(release\s*\{[\s\S]*?signingConfig signingConfigs\.)debug/, '$1tcgRelease');
  if (!source.includes('signingConfig signingConfigs.tcgRelease')) throw new Error('Release signing patch could not be applied safely.');
  result.modResults.contents = source;
  return result;
});
