import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseFiles } from "./files.mjs";
import { releaseNotes } from "./release-notes.mjs";
import { validateChangelogs } from "./changelog.mjs";

export async function validate(root) {
  const json = async file =>
    JSON.parse(await readFile(path.join(root, file), "utf8"));
  const manifest = await json("module.json");
  const pkg = await json("package.json");
  const lock = await json("package-lock.json");
  assert.equal(manifest.id, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  const changelogs = await Promise.all(
    ["CHANGELOG.md", "CHANGELOG.ru.md"].map(file =>
      readFile(path.join(root, file), "utf8")
    )
  );
  validateChangelogs(changelogs[0], changelogs[1]);
  for (const markdown of changelogs) releaseNotes(markdown, pkg.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  assert.deepEqual(manifest.compatibility, {
    minimum: "14",
    verified: "14",
    maximum: "14"
  });
  assert.equal(manifest.relationships?.systems, undefined);
  assert.equal(
    manifest.manifest,
    undefined,
    "No published manifest exists yet."
  );
  assert.equal(
    manifest.download,
    undefined,
    "No published archive exists yet."
  );
  const files = await releaseFiles(root);
  for (const file of [
    ...manifest.esmodules,
    ...manifest.styles,
    ...manifest.languages.map(language => language.path)
  ])
    assert.ok(files.includes(file), `Missing runtime asset: ${file}`);
  const en = await json("lang/en.json");
  const ru = await json("lang/ru.json");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const language of [en, ru])
    for (const value of Object.values(language))
      assert.ok(typeof value === "string" && value.trim());
  for (const file of files.filter(file => file.startsWith("scripts/"))) {
    const source = await readFile(path.join(root, file), "utf8");
    for (const [, key] of source.matchAll(/["'`](RAT\.[A-Za-z.]+)["'`]/g))
      assert.ok(key in en, `Unknown localization key ${key} in ${file}`);
    for (const [, target] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      assert.ok(
        target.startsWith("."),
        `Runtime dependency ${target} in ${file}`
      );
      const resolved = path
        .relative(root, path.resolve(root, path.dirname(file), target))
        .split(path.sep)
        .join("/");
      assert.ok(files.includes(resolved), `Missing import ${resolved}`);
    }
  }
  for (const file of files) await readFile(path.join(root, file));
  return files;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const files = await validate(process.cwd());
  console.log(
    `Validated manifest, localization and ${files.length} package files.`
  );
}
