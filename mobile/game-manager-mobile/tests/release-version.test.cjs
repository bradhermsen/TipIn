const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { prepareRelease, apkFilename } = require("../scripts/release-version.cjs");

function withConfig(config, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tipin-release-test-"));
  const file = path.join(dir, "app.json");
  fs.writeFileSync(file, JSON.stringify(config));
  try {
    run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("release preparation increments builds, permits semantic upgrades, and preserves app settings", () => {
  withConfig({ expo: { version: "1.0.9", android: { versionCode: 7, package: "fixture" }, extra: { eas: { projectId: "fixture" } } } }, file => {
    const sameVersion = prepareRelease(file);
    assert.equal(sameVersion.expo.version, "1.0.9");
    assert.equal(sameVersion.expo.android.versionCode, 8);
    const feature = prepareRelease(file, "1.1.0");
    assert.equal(feature.expo.android.versionCode, 9);
    assert.equal(feature.expo.android.package, "fixture");
    assert.equal(feature.expo.extra.eas.projectId, "fixture");
    assert.equal(apkFilename(feature, "dev"), "TipIn-GM-Dev-v1.1.0-build9.apk");
    assert.equal(apkFilename(feature, "prod"), "TipIn-GM-Prod-v1.1.0-build9.apk");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), feature);
    assert.equal(prepareRelease(file, "2.0.0").expo.android.versionCode, 10);
  });
});

test("invalid or decreasing release versions do not change the prepared metadata", () => {
  withConfig({ expo: { version: "1.2.3", android: { versionCode: 7 } } }, file => {
    const before = fs.readFileSync(file, "utf8");
    for (const version of ["1.2", "01.2.3", "1.2.4-beta", "1.1.9", "1.2.2", "0.9.9"]) {
      assert.throws(() => prepareRelease(file, version), /version/i);
      assert.equal(fs.readFileSync(file, "utf8"), before);
    }
    assert.throws(() => apkFilename(JSON.parse(before), "staging"), /dev or prod/);
  });
});

test("invalid or exhausted Android build numbers cannot produce a new release", () => {
  for (const versionCode of [0, -1, 1.5, 2100000000, 2100000001]) {
    withConfig({ expo: { version: "1.0.0", android: { versionCode } } }, file => {
      const before = fs.readFileSync(file, "utf8");
      assert.throws(() => prepareRelease(file), /versionCode/);
      assert.equal(fs.readFileSync(file, "utf8"), before);
    });
  }
});

const source = ts.createSourceFile("App.tsx", fs.readFileSync(path.join(__dirname, "..", "App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    declarations.set(declaration.name.getText(source), `const ${declaration.getText(source)};`);
  }
}
const metadataCode = ["IS_GAME_MANAGER_BINARY", "APP_RELEASE_ENVIRONMENT", "APP_RELEASE_VERSION", "APP_RELEASE_BUILD", "APP_RELEASE_LABEL"]
  .map(name => declarations.get(name)).join("\n");
const labels = new Map();
function findLabels(node) {
  if (ts.isJsxElement(node)) {
    const id = node.openingElement.attributes.properties.find(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "testID" &&
      attribute.initializer && ts.isStringLiteral(attribute.initializer));
    if (id) labels.set(id.initializer.text, node.getText(source));
  }
  ts.forEachChild(node, findLabels);
}
findLabels(source);

test("login and Settings show the installed APK identity rather than a newer manifest or API environment", () => {
  for (const environment of ["DEV", "PROD"]) {
    for (const id of ["login-release-info", "settings-release-info"]) {
      assert.ok(labels.has(id), `${id} must be visible.`);
      const script = ts.transpileModule(`${metadataCode}\n(${labels.get(id)})`, {
        compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const rendered = vm.runInNewContext(script, {
        Application: { applicationId: `com.TipIn.gamemanager${environment === "DEV" ? ".dev" : ""}`, nativeApplicationVersion: "1.0.1", nativeBuildVersion: "2" },
        Constants: { expoConfig: { version: "9.0.0", android: { versionCode: 999 }, extra: { appEnvironment: environment === "DEV" ? "PROD" : "DEV" } } },
        React: { createElement: (_type, _props, ...children) => children.join("") },
        Text: "Text", styles: {},
      });
      assert.equal(rendered, `${environment} \u00b7 v1.0.1 (build 2)`);
    }
  }
});

test("Expo Go previews use project metadata instead of the Expo Go app's native version", () => {
  const script = ts.transpileModule(`${metadataCode}\nAPP_RELEASE_LABEL`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const label = vm.runInNewContext(script, {
    Application: { applicationId: "host.exp.exponent", nativeApplicationVersion: "54.0.0", nativeBuildVersion: "1000" },
    Constants: { expoConfig: { version: "1.0.2", android: { versionCode: 3 }, extra: { appEnvironment: "DEV" } } },
  });
  assert.equal(label, "DEV \u00b7 v1.0.2 (build 3)");
});
