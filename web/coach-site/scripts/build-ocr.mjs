import { cp, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, "dist");
const target = path.join(output, "vendor");
await mkdir(target, { recursive: true });
for (const name of ["index.html", "config.json", "staticwebapp.config.json", "assets", "css", "js"]) {
  await cp(path.join(root, name), path.join(output, name), { recursive: true });
}
const tesseract = path.dirname(require.resolve("tesseract.js/package.json"));
await cp(path.join(tesseract, "dist"), path.join(target, "tesseract"), { recursive: true });
await cp(path.join(tesseract, "LICENSE.md"), path.join(target, "tesseract", "LICENSE.md"));
const core = path.dirname(require.resolve("tesseract.js-core/package.json"));
await mkdir(path.join(target, "core"), { recursive: true });
for (const name of await readdir(core)) {
  if (name.startsWith("tesseract-core") || name === "LICENSE") await cp(path.join(core, name), path.join(target, "core", name));
}
const eng = path.dirname(require.resolve("@tesseract.js-data/eng/package.json"));
await cp(path.join(eng, "4.0.0"), path.join(target, "eng"), { recursive: true });
await cp(path.join(eng, "README.md"), path.join(target, "eng", "README.md"));
