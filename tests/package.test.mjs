import assert from "node:assert/strict";
import test from "node:test";
import { validate } from "../tools/validate.mjs";

test("installable package includes only runtime and public documentation", async () => {
  const files = await validate(process.cwd());
  assert.ok(files.includes("scripts/main.js"));
  assert.ok(files.includes("lang/ru.json"));
  assert.ok(files.includes("media/demo.webp"));
  assert.ok(files.includes("CHANGELOG.md"));
  assert.ok(files.includes("CHANGELOG.ru.md"));
  assert.ok(files.includes("scripts/foundry/token-config.js"));
  assert.equal(files.includes("scripts/memory-ui.js"), false);
  assert.equal(files.includes("styles/memory.css"), false);
  assert.equal(
    files.some(file =>
      /^(dev|docs|tests|tools|node_modules|\.git)\//.test(file)
    ),
    false
  );
});
