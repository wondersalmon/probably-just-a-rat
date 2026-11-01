import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runtimeHost, token } from "./helpers/runtime.mjs";
import { installModule } from "../scripts/lifecycle.js";
import {
  memoryRules,
  memoryRulesText,
  supportReport
} from "../scripts/memory-status.js";
import { RatControlPanel } from "../scripts/foundry/control-panel.js";

const ID = "probably-just-a-rat";
const strings = Object.fromEntries(
  await Promise.all(
    ["en", "ru"].map(async lang => [
      lang,
      JSON.parse(
        await readFile(new URL(`../lang/${lang}.json`, import.meta.url), "utf8")
      )
    ])
  )
);

function fixture(system = "pf2e", lang = "en") {
  const f = runtimeHost();
  f.host.game.version = "14.369";
  f.host.game.system = { id: system, version: "8.6.1" };
  f.host.game.modules.get(ID).version = "0.3.0";
  f.host.game.i18n.localize = key => strings[lang][key] ?? key;
  f.host.game.i18n.format = (key, values) =>
    f.host.game.i18n
      .localize(key)
      .replace(/\{([^}]+)\}/g, (_match, name) => String(values[name]));
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  return { ...f, controller, api: f.host.game.modules.get(ID).api.memory };
}

test("status shares context gates, prioritizes scene policy and stays healthy when idle", async () => {
  const f = fixture();
  assert.equal(f.frames.size, 0);
  assert.equal(f.api.status().state, "active");
  let mode = "world";
  f.host.canvas.scene.getFlag = (_ns, key) =>
    key === "memoryMode" ? mode : undefined;
  f.host.canvas.visibility.tokenVision = false;
  assert.equal(f.api.status().state, "token-vision");
  mode = "disabled";
  assert.equal(f.api.status().state, "disabled");
  mode = "world";
  f.host.canvas.visibility.tokenVision = true;
  await f.host.game.settings.set(ID, "combatOnly", true);
  assert.equal(f.api.status().state, "combat-only");
  mode = "long";
  assert.equal(f.api.status().state, "active");
  assert.equal(f.api.status().rules.combatOnly, false);
  f.observer.allowed = false;
  assert.equal(f.api.status().state, "no-source");
  f.host.game.user.isGM = true;
  assert.equal(f.api.status().state, "select-token");
  f.observer.controlled = true;
  f.source.isBlinded = true;
  assert.equal(f.api.status().state, "blinded");
  f.host.canvas.ready = false;
  assert.equal(f.api.status().state, "no-scene");
  assert.ok(Object.isFrozen(f.api.status()));
  assert.ok(Object.isFrozen(f.api.status().rules));
  f.controller.dispose();
  assert.equal(f.api.status(), null);
});

test("empty-list subscribers receive coalesced status, policy and role changes without polling", async () => {
  const f = fixture();
  // Let the ready hook finish its asynchronous initial language notification.
  await Promise.resolve();
  let calls = 0;
  const states = [];
  const off = f.api.subscribe(() => {
    calls++;
    states.push(f.api.status().state);
  });
  f.observer.allowed = false;
  f.emit("updateActor");
  f.emit("updateActor");
  f.frame();
  assert.deepEqual(states, ["no-source"]);
  f.emit("updateActor");
  f.frame();
  assert.equal(calls, 1);
  await f.host.game.settings.set(ID, "memoryRounds", 4);
  assert.equal(calls, 2);
  f.host.game.user.isGM = true;
  f.emit("updateUser", f.host.game.user);
  f.frame();
  assert.equal(states.at(-1), "select-token");
  const afterRole = calls;
  f.observer.controlled = true;
  f.emit("controlToken");
  f.frame();
  assert.equal(calls, afterRole + 1);
  assert.equal(states.at(-1), "active");
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  off();
  f.controller.dispose();
  assert.equal(f.listeners.size, 0);
});

test("missing native API is readable without throwing and suspension notifies once", () => {
  const f = fixture();
  delete f.host.canvas.visibility._createVisibilityTestConfig;
  assert.equal(f.api.status().state, "unsupported");
  assert.deepEqual(f.api.list(), []);
  let calls = 0;
  f.api.subscribe(() => calls++);
  f.emit("updateActor");
  f.frame();
  assert.equal(f.api.status().state, "suspended");
  assert.equal(calls, 1);
  assert.equal(f.warnings.length, 1);
  f.emit("updateActor");
  assert.equal(calls, 1);
  f.controller.dispose();
});

for (const system of ["pf2e", "sf2e", "daggerheart", "generic"])
  for (const lang of ["en", "ru"])
    test(`saved rule summaries match policy, including Long memory (${system}, ${lang})`, async () => {
      const f = fixture(system, lang);
      assert.equal(
        f.api.status().rules.lifetime,
        system === "daggerheart" ? "steps" : "rounds"
      );
      assert.match(memoryRulesText(f.host, memoryRules(f.host)).summary, /2/);
      if (system === "daggerheart") {
        await f.host.game.settings.set(
          ID,
          "daggerheartCombatMemory",
          "encounter"
        );
        assert.equal(f.api.status().rules.rounds, 0);
        assert.ok(
          memoryRulesText(f.host, memoryRules(f.host)).summary.includes(
            strings[lang]["RAT.Rules.encounter"]
          )
        );
      }
      await f.host.game.settings.set(ID, "combatOnly", true);
      await f.host.game.settings.set(ID, "rememberHidden", true);
      const world = memoryRulesText(f.host, memoryRules(f.host));
      assert.ok(
        world.detail.includes(strings[lang]["RAT.Scene.Effective.KeepHidden"])
      );
      assert.ok(
        world.detail.includes(strings[lang]["RAT.Scene.Effective.CombatOnly"])
      );
      assert.doesNotMatch(world.summary, /RAT\.|\{.+\}/);
      const long = memoryRules(f.host, "long");
      assert.equal(long.combatOnly, false);
      assert.equal(long.keepHidden, true);
      assert.equal(
        memoryRulesText(f.host, long).detail,
        strings[lang]["RAT.Scene.Effective.long"]
      );
      assert.equal(
        memoryRulesText(f.host, memoryRules(f.host, "disabled")).summary,
        strings[lang]["RAT.Rules.disabled"]
      );
      assert.equal(f.api.status().rules.mode, "world");
      f.controller.dispose();
    });

test("support report is GM-only and excludes target data, identifiers and diagnostics", () => {
  const f = fixture();
  assert.equal(f.api.supportReport(), null);
  f.host.game.user.isGM = true;
  f.observer.controlled = true;
  const enemy = token(f.host, "secret-id");
  for (const key of ["name", "x", "y", "texture"])
    Object.defineProperty(enemy.document, key, {
      get() {
        throw new Error("Target read in report");
      }
    });
  f.host.game.world = { id: "private-world" };
  const report = f.api.supportReport();
  const parsed = JSON.parse(report);
  assert.deepEqual(Object.keys(parsed), [
    "reportVersion",
    "foundry",
    "rat",
    "system",
    "state",
    "rules"
  ]);
  assert.deepEqual(parsed.foundry, { generation: 14, version: "14.369" });
  assert.deepEqual(parsed.system, { id: "pf2e", version: "8.6.1" });
  assert.equal(parsed.rat, "0.3.0");
  assert.doesNotMatch(
    report,
    /secret|private|hero|player|samples|observedAt|tokenId|sceneId/
  );
  f.host.game.system.version = "private/path\nleak";
  assert.equal(JSON.parse(f.api.supportReport()).system.version, "unknown");
  f.host.game.user.isGM = false;
  assert.equal(f.api.supportReport(), null);
  f.controller.dispose();
  assert.equal(f.api.supportReport(), null);
});

test("copy checks rights, handles unavailable clipboard and never enables diagnostics", async () => {
  const f = fixture();
  const panel = new RatControlPanel(f.host, f.api, () => {});
  panel.window = { render() {}, close() {} };
  panel.open = true;
  let copies = 0,
    notices = 0;
  f.host.navigator = {
    clipboard: {
      writeText: async text => {
        copies++;
        assert.equal(JSON.parse(text).reportVersion, 1);
      }
    }
  };
  f.host.ui.notifications.info = () => notices++;
  assert.equal(await panel.copyReport(), false);
  assert.equal(copies, 0);
  f.host.game.user.isGM = true;
  assert.equal(await panel.copyReport(), true);
  assert.equal(copies, 1);
  assert.equal(notices, 1);
  f.host.navigator.clipboard.writeText = async () => {
    throw new Error("denied");
  };
  assert.equal(await panel.copyReport(), false);
  assert.equal(panel.manualReport, true);
  assert.equal(notices, 1);
  delete f.host.navigator;
  assert.equal(await panel.copyReport(), false);
  assert.equal(panel.manualReport, true);
  assert.equal(f.host.game.modules.get(ID).api.getDiagnostics().enabled, false);
  panel.closed();
  assert.equal(panel.manualReport, false);
  panel.dispose();
  f.controller.dispose();
});

test("pending clipboard cannot show fallback after role loss, close or disposal", async () => {
  for (const change of ["role", "close", "dispose"]) {
    const f = fixture();
    f.host.game.user.isGM = true;
    const panel = new RatControlPanel(f.host, f.api, () => {});
    panel.window = { render() {}, close() {} };
    panel.open = true;
    let reject,
      notices = 0;
    f.host.ui.notifications.info = () => notices++;
    f.host.navigator = {
      clipboard: {
        writeText: () =>
          new Promise((_resolve, no) => {
            reject = no;
          })
      }
    };
    const pending = panel.copyReport();
    assert.equal(await panel.copyReport(), false);
    if (change === "role") f.host.game.user.isGM = false;
    else if (change === "close") panel.closed();
    else panel.dispose();
    reject(new Error("denied"));
    assert.equal(await pending, false);
    assert.equal(panel.manualReport, false);
    assert.equal(notices, 0);
    panel.dispose();
    f.controller.dispose();
  }
});

test("report whitelist rejects extra nested fields, invalid values and object serializers", () => {
  const f = fixture();
  f.host.game.user.isGM = true;
  const rules = {
    ...memoryRules(f.host),
    privateToken: "secret",
    toJSON() {
      throw new Error("Serialized rules object");
    }
  };
  const report = supportReport(f.host, "active", rules);
  assert.deepEqual(Object.keys(JSON.parse(report).rules), [
    "mode",
    "lifetime",
    "rounds",
    "minutes",
    "combatOnly",
    "keepHidden"
  ]);
  assert.doesNotMatch(report, /privateToken|secret|toJSON/);
  rules.mode = "private-mode";
  rules.rounds = NaN;
  rules.minutes = Infinity;
  const invalid = JSON.parse(supportReport(f.host, "secret-state", rules));
  assert.equal(invalid.state, "unknown");
  assert.equal(invalid.rules.mode, "unknown");
  assert.equal(invalid.rules.rounds, null);
  assert.equal(invalid.rules.minutes, null);
  f.controller.dispose();
});

test("clipboard completion belongs to the panel session that requested it", async () => {
  for (const success of [true, false]) {
    const f = fixture();
    f.host.game.user.isGM = true;
    const panel = new RatControlPanel(f.host, f.api, () => {});
    panel.window = { render() {}, close() {} };
    panel.open = true;
    let finish,
      notices = 0;
    f.host.ui.notifications.info = () => notices++;
    f.host.navigator = {
      clipboard: {
        writeText: () =>
          new Promise((yes, no) => {
            finish = success ? yes : no;
          })
      }
    };
    const pending = panel.copyReport();
    panel.closed();
    panel.open = true;
    finish();
    assert.equal(await pending, success);
    assert.equal(panel.manualReport, false);
    assert.equal(notices, 0);
    panel.dispose();
    f.controller.dispose();
  }
});

// Plain Node objects exercise content and permissions only, never native DOM or layout.
class Element {
  children = [];
  dataset = {};
  attributes = {};
  constructor(tag) {
    this.tagName = tag;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(child) {
    this.appendChild(child);
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener() {}
}
const flatten = element => [element, ...element.children.flatMap(flatten)];

for (const lang of ["en", "ru"])
  test(`panel renders status, saved rules and a permission-checked manual report (${lang})`, () => {
    const f = fixture("daggerheart", lang);
    f.host.document = { createElement: tag => new Element(tag) };
    const panel = new RatControlPanel(f.host, f.api, () => {});
    let elements = flatten(panel.build());
    assert.equal(
      elements.find(e => e.className === "rat-controls-empty").textContent,
      strings[lang]["RAT.Controls.Empty"]
    );
    assert.ok(
      elements
        .find(e => e.className === "rat-controls-rules")
        .textContent.includes("2")
    );
    assert.equal(
      elements.some(e => e.dataset.ratAction === "report"),
      false
    );
    f.host.game.user.isGM = true;
    panel.manualReport = true;
    elements = flatten(panel.build());
    assert.equal(
      elements.find(e => e.className === "rat-controls-empty").textContent,
      strings[lang]["RAT.Status.select-token"]
    );
    assert.ok(elements.some(e => e.dataset.ratAction === "report"));
    const text = elements.find(e => e.tagName === "textarea");
    assert.equal(text.readOnly, true);
    assert.equal(JSON.parse(text.value).system.id, "daggerheart");
    f.host.game.user.isGM = false;
    elements = flatten(panel.build());
    assert.equal(
      elements.some(
        e => e.tagName === "textarea" || e.dataset.ratAction === "report"
      ),
      false
    );
    assert.equal(panel.manualReport, false);
    panel.dispose();
    f.controller.dispose();
  });
