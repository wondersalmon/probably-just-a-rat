import assert from "node:assert/strict";
import test from "node:test";
import { releaseNotes } from "../tools/release-notes.mjs";

test("release notes accept plain version headings and stop at either heading format", () => {
  const source =
    "# Changes\n\n## 0.1.0\n\nFirst release.\n\n## [0.0.1] - Earlier\n\nOld notes.\n";
  assert.equal(releaseNotes(source, "0.1.0"), "## 0.1.0\n\nFirst release.\n");
  assert.throws(() =>
    releaseNotes(`${source}\n## [0.1.0]\n\nDuplicate.\n`, "0.1.0")
  );
});

test("release notes select exactly the requested version and preserve multiline Markdown", () => {
  const text =
    "# Changelog\n\n## [0.2.0] - 2026-11-01\n\nFuture.\n\n## [0.1.0] - 2026-10-15\n\nInitial release.\n\n- Frozen ghosts.\n- EN/RU.\n\n## [0.1.0-beta.1] - 2026-10-14\n\nPreview.\n";
  assert.equal(
    releaseNotes(text, "0.1.0"),
    "## [0.1.0] - 2026-10-15\n\nInitial release.\n\n- Frozen ghosts.\n- EN/RU.\n"
  );
  assert.match(releaseNotes(text, "0.1.0-beta.1"), /Preview\./);
  assert.throws(() => releaseNotes(text, "0.3.0"));
  assert.throws(() =>
    releaseNotes(text + "\n## [0.1.0]\nDuplicate.\n", "0.1.0")
  );
  assert.throws(() => releaseNotes("## [0.1.0]\n", "0.1.0"));
  assert.throws(() => releaseNotes(text, "0.1.0.*"));
});
