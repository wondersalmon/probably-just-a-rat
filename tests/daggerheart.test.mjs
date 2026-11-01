import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { registerSettings, memoryPolicy } from "../scripts/settings.js";
import { encounterMemory, memoryTextKey } from "../scripts/system-profile.js";
import { installModule } from "../scripts/lifecycle.js";
import { SettingsPreview } from "../scripts/foundry/settings-preview.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";

const ID = "probably-just-a-rat";
const strings = Object.fromEntries(
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

// Models Daggerheart 2.10.13's native round/turn updates, not its canvas engine.
function fixture(language = "en") {
  const f = runtimeHost();
  f.host.game.system = { id: "daggerheart" };
  f.host.game.combat = {
    id: "encounter",
    started: true,
    scene: null,
    round: 1,
    turn: null
  };
  f.host.game.i18n.localize = key => strings[language][key] ?? key;
  f.host.game.i18n.format = (key, values) =>
    f.host.game.i18n
      .localize(key)
      .replace(/\{([^}]+)\}/g, (_match, name) => String(values[name]));
  let time = 0;
  const store = new MemoryStore({ now: () => time });
  const tracker = new ObservationTracker(f.host, store);
  registerSettings(
    f.host.game.settings,
    () => {
      tracker.updatePolicy();
      tracker.renderer.refreshCaptions();
      tracker.notifyMemory(true);
    },
    undefined,
    undefined,
    undefined,
    "daggerheart"
  );
  const enemy = token(f.host);
  const update = () => {
    tracker.schedule();
    f.frame();
    assert.equal(tracker.failed, false);
  };
  const loseSight = () => {
    enemy.visual = enemy.visible = false;
    update();
  };
  return {
    ...f,
    store,
    tracker,
    enemy,
    update,
    loseSight,
    advance: ms => {
      time += ms;
    },
    setMode: mode =>
      f.host.game.settings.set(ID, "daggerheartCombatMemory", mode)
  };
}

test("Daggerheart registers an explicit GM choice while preserving the native counter setting", async () => {
  const f = fixture();
  const choice = f.settings.get("daggerheartCombatMemory");
  assert.equal(choice.scope, "world");
  assert.equal(choice.default, "steps");
  assert.deepEqual(Object.keys(choice.choices), ["steps", "encounter"]);
  assert.equal(
    f.settings.get("memoryRounds").name,
    "RAT.Daggerheart.MemorySteps.Name"
  );
  assert.equal(
    f.settings.get("showRounds").hint,
    "RAT.Daggerheart.ShowSteps.Hint"
  );
  await f.host.game.settings.set(ID, "memoryRounds", 7);
  await f.setMode("encounter");
  assert.equal(
    memoryPolicy(f.host.game.settings, undefined, "daggerheart").combatRounds,
    0
  );
  await f.setMode("steps");
  assert.equal(f.host.game.settings.get(ID, "memoryRounds"), 7);
  assert.equal(
    memoryPolicy(f.host.game.settings, undefined, "daggerheart").combatRounds,
    7
  );
  f.settings.get("daggerheartCombatMemory").value = "broken";
  assert.equal(encounterMemory(f.host.game.settings, "daggerheart"), false);
  f.tracker.suspend();
});

for (const systemId of [
  undefined,
  "dnd5e",
  "pf2e",
  "sf2e",
  "daggerheart-unofficial"
])
  test(`other systems retain round-based settings and labels (${systemId})`, () => {
    const f = runtimeHost();
    registerSettings(
      f.host.game.settings,
      () => {},
      undefined,
      undefined,
      undefined,
      systemId
    );
    assert.equal(f.settings.has("daggerheartCombatMemory"), false);
    assert.equal(
      f.settings.get("memoryRounds").name,
      "RAT.Settings.memoryRounds.Name"
    );
    assert.equal(
      memoryTextKey(systemId, "RAT.RoundsSinceLoss"),
      "RAT.RoundsSinceLoss"
    );
    assert.equal(
      memoryPolicy(f.host.game.settings, undefined, systemId).combatRounds,
      2
    );
  });

for (const language of ["en", "ru"])
  test(`spotlight assignments and clearing count as steps with localized captions (${language})`, () => {
    const f = fixture(language);
    f.update();
    f.loseSight();
    f.host.game.combat.round = 2;
    f.host.game.combat.turn = 0;
    f.update();
    assert.equal(
      f.tracker.renderer.label(f.store.get("enemy")),
      strings[language]["RAT.Daggerheart.StepsSinceLoss"].replace(
        "{rounds}",
        "1"
      )
    );
    f.host.game.combat.round = 1;
    f.update();
    assert.equal(f.store.roundsSinceLoss(f.store.get("enemy")), 1);
    f.host.game.combat.round = 3;
    f.host.game.combat.turn = null;
    f.update();
    assert.equal(f.store.size, 0);
    assert.equal(f.tracker.renderer.markers.size, 0);
    f.tracker.suspend();
  });

test("encounter mode ignores spotlight and real time but clears at encounter end and replacement", async () => {
  for (const replacement of [
    null,
    { id: "next-encounter", started: true, scene: null, round: 1, turn: null }
  ]) {
    const f = fixture();
    await f.setMode("encounter");
    f.update();
    f.loseSight();
    const snapshot = f.store.get("enemy").snapshot;
    f.advance(86_400_000);
    f.host.game.combat.round = 500;
    f.update();
    assert.equal(f.store.get("enemy").snapshot, snapshot);
    assert.equal(
      f.tracker.renderer.label(f.store.get("enemy")),
      strings.en["RAT.LastPosition"]
    );
    f.host.game.combat = replacement;
    f.update();
    assert.equal(f.store.size, 0);
    f.tracker.suspend();
  }
});

test("changing expiry modes retains the original loss age and never resurrects expired positions", async () => {
  const f = fixture();
  f.update();
  f.loseSight();
  f.host.game.combat.round = 2;
  f.update();
  const snapshot = f.store.get("enemy").snapshot;
  const texture = f.tracker.renderer.textures.get("enemy").texture;
  await f.setMode("encounter");
  f.host.game.combat.round = 10;
  f.update();
  assert.equal(f.store.get("enemy").snapshot, snapshot);
  assert.equal(f.tracker.renderer.textures.get("enemy").texture, texture);
  await f.setMode("steps");
  assert.equal(f.store.size, 0);
  await f.setMode("encounter");
  f.update();
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("encounter memory still clears on rediscovery and manual removal; outside encounters minutes apply", async () => {
  const f = fixture();
  await f.setMode("encounter");
  f.update();
  f.loseSight();
  f.enemy.visual = f.enemy.visible = true;
  f.update();
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.loseSight();
  f.tracker.forget("enemy");
  f.update();
  assert.equal(f.store.size, 0);
  f.host.game.combat = null;
  f.enemy.visual = f.enemy.visible = true;
  f.update();
  f.loseSight();
  f.advance(60_000);
  assert.equal(f.store.records().length, 0);
  f.tracker.suspend();
});

test("long scene memory overrides encounter expiry and GM Hidden without exposing unknown tokens", async () => {
  const f = fixture();
  await f.setMode("encounter");
  f.host.canvas.scene.getFlag = (_namespace, key) =>
    key === "memoryMode" ? "long" : undefined;
  f.update();
  const snapshot = f.store.get("enemy").snapshot;
  f.enemy.document.hidden = true;
  const unknown = token(f.host, "unknown");
  unknown.document.hidden = true;
  f.host.game.combat = null;
  f.advance(86_400_000);
  f.update();
  assert.equal(f.store.get("enemy").snapshot, snapshot);
  assert.equal(f.store.get("unknown"), undefined);
  f.host.canvas.scene.id = "other-scene";
  f.update();
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("encounter mode preserves the existing checkpoint format and spotlight high-water after reload", async () => {
  const f = fixture();
  await f.setMode("encounter");
  f.update();
  f.loseSight();
  f.host.game.combat.round = 20;
  f.update();
  const saved = f.store.checkpoint();
  const reloaded = new MemoryStore({
    now: () => 100_000,
    policy: memoryPolicy(f.host.game.settings, undefined, "daggerheart")
  });
  reloaded.setContext(f.tracker.adapter.context());
  reloaded.setCombat(f.tracker.adapter.combat());
  reloaded.restore(saved, 100_000);
  assert.equal(reloaded.get("enemy").snapshot.x, saved.records[0].snapshot.x);
  assert.equal(reloaded.roundsSinceLoss(reloaded.get("enemy")), 19);
  reloaded.setPolicy({ combatRounds: 2 });
  assert.equal(reloaded.size, 0);
  f.tracker.suspend();
});

test("native bootstrap passes the Daggerheart profile and applies saved mode changes immediately", async () => {
  const f = runtimeHost();
  f.host.game.system = { id: "daggerheart" };
  f.host.game.combat = {
    id: "encounter",
    started: true,
    scene: null,
    round: 1,
    turn: null
  };
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const memory = f.host.game.modules.get(ID).api.memory;
  assert.match(memory.list()[0].label, /Daggerheart.StepsSinceLoss/);
  await f.host.game.settings.set(ID, "daggerheartCombatMemory", "encounter");
  assert.equal(memory.list()[0].label, "RAT.LastPosition");
  f.host.game.combat.round = 10;
  f.emit("updateCombat");
  f.frame();
  assert.equal(memory.list().length, 1);
  await f.host.game.settings.set(ID, "daggerheartCombatMemory", "steps");
  assert.equal(memory.list().length, 0);
  controller.dispose();
  assert.equal(f.listeners.size, 0);
});

test("native form submission saves a longer limit before enabling step expiry", async () => {
  const f = fixture();
  await f.setMode("encounter");
  f.update();
  f.loseSight();
  f.host.game.combat.round = 6;
  f.update();
  const root = new EventTarget();
  root.querySelector = () => null;
  const preview = new SettingsPreview(f.host, () => {});
  const app = {};
  preview.mount(app, root);
  const object = {
    [`${ID}.daggerheartCombatMemory`]: "steps",
    [`${ID}.memoryRounds`]: 10
  };
  const event = new Event("formdata");
  Object.defineProperty(event, "formData", { value: { object } });
  root.dispatchEvent(event);
  for (const [name, value] of Object.entries(object))
    await f.host.game.settings.set(ID, name.slice(ID.length + 1), value);
  assert.equal(f.store.get("enemy").state, "remembered");
  assert.equal(f.store.roundsSinceLoss(f.store.get("enemy")), 5);
  preview.unmount(app);
  const untouched = {
    [`${ID}.daggerheartCombatMemory`]: "encounter",
    [`${ID}.memoryRounds`]: 3
  };
  const afterClose = new Event("formdata");
  Object.defineProperty(afterClose, "formData", {
    value: { object: untouched }
  });
  root.dispatchEvent(afterClose);
  assert.equal(Object.keys(untouched)[0], `${ID}.daggerheartCombatMemory`);
  preview.dispose();
  f.tracker.suspend();
});
