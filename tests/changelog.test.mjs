import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { changelogShape, validateChangelogs } from "../tools/changelog.mjs";
import { releaseNotes } from "../tools/release-notes.mjs";

const en = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const ru = await readFile(
  new URL("../CHANGELOG.ru.md", import.meta.url),
  "utf8"
);

test("all historical and pending changelogs follow the bilingual format", () => {
  validateChangelogs(en, ru);
  const notes = releaseNotes(en, "0.1.1");
  assert.match(notes, /### New\n/);
  assert.match(notes, /- \*\*Manual release builds:\*\*/);
  assert.match(notes, /Documentation: .*README\.md.*CHANGELOG\.ru\.md#011/);
  assert.doesNotMatch(notes, /## (?:Unreleased|0\.1\.0)/);
  const prepared = releaseNotes(en, "0.2.1");
  assert.match(prepared, /- \*\*Marker styles:\*\*/);
  assert.match(prepared, /blob\/main\/README\.md/);
  assert.match(prepared, /CHANGELOG\.ru\.md#021/);
  assert.doesNotMatch(prepared, /## 0\.1\./);
});

test("reject category, bullet and documentation format drift", () => {
  for (const invalid of [
    en.replace("### New", "### Added"),
    en.replace("- **Marker styles:**", "- Marker styles:"),
    en.replace("### Fixes\n", ""),
    en.replace("Documentation:", "See:"),
    en.replace("blob/main/README.md", "blob/HEAD/README.md"),
    en.replace("blob/main/README.md", "blob/v0.2.1/README.md"),
    en.replace("CHANGELOG.ru.md#011", "CHANGELOG.ru.md#010"),
    en.replace(" · ", " / ")
  ])
    assert.throws(() => validateChangelogs(invalid, ru));
});

test("reject missing translations, duplicates and mismatched category counts", () => {
  assert.throws(() =>
    validateChangelogs(en, ru.replace(/## 0\.1\.0[\s\S]*/, ""))
  );
  assert.throws(() => validateChangelogs(en + releaseNotes(en, "0.1.1"), ru));
  assert.throws(() =>
    validateChangelogs(en.replace(/- \*\*Marker styles:\*\*[^\n]*\n/, ""), ru)
  );
});

test("allow omitted categories while preserving bilingual counts and release notes", () => {
  const english = releaseNotes(en, "0.3.0");
  const russian = releaseNotes(ru, "0.3.0");
  assert.deepEqual(changelogShape(english, "en"), { "0.3.0": [3, 0, 1] });
  validateChangelogs(english, russian);
  assert.doesNotMatch(english, /### Changes and improvements|Unreleased/);
  const fixesOnly = english.replace(/### New\n[\s\S]*?(?=### Fixes)/, "");
  assert.deepEqual(changelogShape(fixesOnly, "en"), { "0.3.0": [0, 0, 1] });
  const pending = text =>
    text.replaceAll("0.3.0", "Unreleased").replace("#030", "#unreleased");
  validateChangelogs(pending(english), pending(russian));
});

test("reject empty categories, empty versions, duplicates and category reordering", () => {
  const release = releaseNotes(en, "0.3.0");
  const footer = release.slice(release.indexOf("Documentation:"));
  for (const invalid of [
    release.replace("### Fixes", "### Changes and improvements\n\n### Fixes"),
    release.replace(/^- \*\*See Invisibility:\*\*[^\n]*/m, ""),
    release.replace("### Fixes", "### New"),
    release
      .replace("### New", "### Fixes")
      .replace("### Fixes\n\n- **See", "### New\n\n- **See"),
    `## 0.3.0\n\n${footer}`,
    `## Unreleased\n\n${footer.replace("#030", "#unreleased")}`
  ])
    assert.throws(() => changelogShape(invalid, "en"));
});
