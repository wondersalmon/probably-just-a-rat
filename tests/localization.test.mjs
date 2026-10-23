import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localize, format, snapshotName } from "../scripts/localization.js";
import { installModule } from "../scripts/lifecycle.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";
const ID = "probably-just-a-rat";
const dictionaries = Object.fromEntries(
  await Promise.all(
    ["en", "ru"].map(async language => [
      language,
      JSON.parse(
        await readFile(
          new URL(`../lang/${language}.json`, import.meta.url),
          "utf8"
        )
      )
    ])
  )
);

for (const language of ["en", "ru"])
  test(`default module language follows Foundry without an extra dictionary fetch (${language})`, async () => {
    const f = runtimeHost();
    const strings = dictionaries[language];
    const native = key => strings[key] ?? key;
    f.host.game.i18n.localize = native;
    f.host.game.i18n.format = (key, values) =>
      native(key).replace(/\{([^}]+)\}/g, (_match, name) =>
        String(values[name])
      );
    f.host.fetch = () => {
      throw new Error("Module must not load its own dictionaries");
    };
    const get = f.host.game.settings.get;
    f.host.game.settings.get = (namespace, key) => {
      assert.notEqual(
        key,
        "showMarkers",
        "retired off switch must not block automatic startup"
      );
      return get(namespace, key);
    };
    const controller = installModule(f.host);
    const enemy = token(f.host);
    f.emit("init");
    f.emit("ready");
    f.frame();
    enemy.visual = enemy.visible = false;
    f.emit("refreshToken", enemy);
    f.frame();
    const root = f.host.canvas.interface.children.find(
      child => child.name === "probably-just-a-rat-memory"
    );
    const marker = root.children[0];
    assert.equal(
      marker.children.at(-1).children[1].text,
      `Known enemy\n${strings["RAT.LastPosition"]}`
    );
    assert.equal(
      localize(f.host, "RAT.PingAudience.Local"),
      strings["RAT.PingAudience.Local"]
    );
    assert.equal(
      format(f.host, "RAT.RoundsSinceLoss", { rounds: 7 }),
      strings["RAT.RoundsSinceLoss"].replace("{rounds}", "7")
    );
    assert.equal(snapshotName(f.host, ""), strings["RAT.Unknown"]);
    assert.equal(snapshotName(f.host, "RAT.Unknown"), "RAT.Unknown");
    assert.equal(f.host.game.i18n.localize, native);
    assert.equal(f.menus.size, 0);
    assert.equal(f.settings.size, 17);
    assert.equal(
      f.host.game.modules.get(ID).api.getDiagnostics().failed,
      false
    );
    controller.dispose();
  });
