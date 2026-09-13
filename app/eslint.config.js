const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([expo, { ignores: ['dist/**', 'dist-e2e/**', 'dist-android/**', 'dist-ios/**', 'dist-native/**', 'android/**', 'ios/**'] }]);
