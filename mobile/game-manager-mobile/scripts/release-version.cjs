const fs = require("node:fs");
const path = require("node:path");

const configPath = path.join(__dirname, "..", "app.json");
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const maxBuildNumber = 2100000000;

function readRelease(file) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const { version, android } = config.expo;
  if (!versionPattern.test(version) || !Number.isSafeInteger(android?.versionCode) ||
      android.versionCode < 1 || android.versionCode > maxBuildNumber) {
    throw new Error("app.json must contain a major.minor.patch version and a valid Android versionCode.");
  }
  return config;
}

function prepareRelease(file, nextVersion) {
  const config = readRelease(file);
  const version = nextVersion ?? config.expo.version;
  if (!versionPattern.test(version)) throw new Error("Use a version such as 1.0.2 or 1.1.0.");
  const currentParts = config.expo.version.split(".").map(BigInt);
  const nextParts = version.split(".").map(BigInt);
  for (let i = 0; i < currentParts.length; i++) {
    if (nextParts[i] < currentParts[i]) throw new Error("Release versions cannot go backwards.");
    if (nextParts[i] > currentParts[i]) break;
  }
  if (config.expo.android.versionCode === maxBuildNumber) throw new Error("Android versionCode limit reached.");
  config.expo.version = version;
  config.expo.android.versionCode++;
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function apkFilename(config, environment) {
  if (environment !== "dev" && environment !== "prod") throw new Error("Choose dev or prod.");
  return `TipIn-GM-${environment === "dev" ? "Dev" : "Prod"}-v${config.expo.version}-build${config.expo.android.versionCode}.apk`;
}

if (require.main === module) {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Too many release arguments.");
  if (command === "prepare") {
    const config = prepareRelease(configPath, argument);
    console.log(`Prepared v${config.expo.version} (build ${config.expo.android.versionCode}).`);
    console.log(apkFilename(config, "dev"));
    console.log(apkFilename(config, "prod"));
    console.log("Commit app.json with the release changes before building. Keep this number when reproducing the same release.");
  } else if (command === "filename") {
    console.log(apkFilename(readRelease(configPath), argument));
  } else {
    throw new Error("Use prepare [major.minor.patch] or filename <dev|prod>.");
  }
}

module.exports = { prepareRelease, apkFilename };
