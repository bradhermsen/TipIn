// Dev builds get their own package ID and name so they install beside the production app.
module.exports = ({ config }) => {
  const isDev = process.env.APP_ENV === "dev";
  return {
    ...config,
    name: isDev ? "TipIn GM Dev" : config.name,
    android: {
      ...config.android,
      package: isDev ? "com.TipIn.gamemanager.dev" : config.android.package,
    },
  };
};
