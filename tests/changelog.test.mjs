import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateChangelogs } from "../tools/changelog.mjs";
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

test("allow an empty Unreleased section after preparing a release", () => {
  const clearPending = markdown => {
    const pending = releaseNotes(markdown, "0.2.1")
      .replace("## 0.2.1", "## Unreleased")
      .replace("#021", "#unreleased")
      .replace(/^- .*\r?\n/gm, "");
    return `${pending}\n${markdown.slice(markdown.indexOf("## "))}`;
  };
  validateChangelogs(clearPending(en), clearPending(ru));
});
