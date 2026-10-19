import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { check } from "prettier";

test("version preparation preserves unchanged bytes, formats new versions and rejects invalid input without writes", async t => {
  const root = process.cwd();
  const parent = path.join(root, "dev");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "version-sync-test-"));
  t.after(async () => {
    assert.ok(directory.startsWith(`${parent}${path.sep}version-sync-test-`));
    await rm(directory, { recursive: true, force: true });
  });
  const files = ["package.json", "package-lock.json", "module.json"];
  const originals = await Promise.all(
    files.map(file => readFile(file, "utf8"))
  );
  for (let i = 0; i < files.length; i++)
    await writeFile(path.join(directory, files[i]), originals[i]);
  const config = JSON.parse(await readFile(".prettierrc.json", "utf8"));
  await writeFile(
    path.join(directory, ".prettierrc.json"),
    JSON.stringify(config)
  );
  const run = version =>
    spawnSync(
      process.execPath,
      [path.join(root, "tools/sync-version.mjs"), version],
      { cwd: directory, encoding: "utf8" }
    );
  const contents = () =>
    Promise.all(
      files.map(file => readFile(path.join(directory, file), "utf8"))
    );
  const version = JSON.parse(originals[0]).version;
  assert.equal(run(version).status, 0);
  assert.deepEqual(await contents(), originals);
  const nextVersion = "0.1.1-beta.1";
  const result = run(nextVersion);
  assert.equal(result.status, 0, result.stderr);
  const updated = await contents();
  for (let i = 0; i < files.length; i++) {
    assert.equal(JSON.parse(updated[i]).version, nextVersion);
    assert.equal(
      await check(updated[i], { ...config, filepath: files[i] }),
      true
    );
  }
  assert.equal(JSON.parse(updated[1]).packages[""].version, nextVersion);
  assert.notEqual(run("invalid").status, 0);
  assert.deepEqual(await contents(), updated);
});
