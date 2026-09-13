const { nativeConfig } = require('./scripts/native-config.cjs');
module.exports = ({ config }) => nativeConfig(config);
