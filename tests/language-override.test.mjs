import assert from "node:assert/strict";
import test from "node:test";
import {
  configureLocalization,
  disposeLocalization,
  localize,
  format
} from "../scripts/localization.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost } from "./helpers/runtime.mjs";
import { readFile } from "node:fs/promises";

const ID = "probably-just-a-rat";

test("personal language switches EN/RU and back to Foundry without changing native localization", async t => {
  const f = runtimeHost();
  registerSettings(f.host.game.settings, () => {});
  const native = key => "native:" + key;
  f.host.game.i18n.localize = native;
  f.host.game.i18n.format = (key, values) => native(key) + ":" + values.rounds;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    const data = JSON.parse(await readFile(url, "utf8"));
    return { ok: true, json: async () => data };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    disposeLocalization(f.host);
  });
  for (const [language, title] of [
    ["en", "Preview"],
    ["ru", "Предпросмотр"]
  ]) {
    await f.host.game.settings.set(ID, "language", language);
    await configureLocalization(f.host);
    assert.equal(localize(f.host, "RAT.Settings.Preview.Title"), title);
    assert.match(format(f.host, "RAT.RoundsSinceLoss", { rounds: 7 }), /7/);
    assert.equal(localize(f.host, "CORE.Test"), "native:CORE.Test");
    assert.equal(f.host.game.i18n.localize, native);
  }
  await f.host.game.settings.set(ID, "language", "foundry");
  await configureLocalization(f.host);
  assert.equal(
    localize(f.host, "RAT.Settings.Preview.Title"),
    "native:RAT.Settings.Preview.Title"
  );
  assert.equal(
    format(f.host, "RAT.RoundsSinceLoss", { rounds: 4 }),
    "native:RAT.RoundsSinceLoss:4"
  );
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => /\/lang\/(en|ru)\.json$/.test(url)));
});
