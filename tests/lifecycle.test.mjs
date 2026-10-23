import assert from "node:assert/strict";
import test from "node:test";
import { installModule } from "../scripts/lifecycle.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";
import { MODULE_ID } from "../scripts/constants.js";

test("native position refreshes preserve the last visible position and heading even when scheduled observations coalesce", async () => {
  const f = runtimeHost();
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  await f.host.game.settings.set(MODULE_ID, "markerStyle", "footprints");
  await f.host.game.settings.set(MODULE_ID, "customMarkerRotate", true);
  f.frame();
  enemy.document.x = 1800;
  enemy.animationContexts.set("movement", {});
  for (const x of [100, 200, 300, 400, 500]) {
    enemy.position.x = x;
    enemy.mesh.position.x = x + 50;
    f.emit("refreshToken", enemy, {
      refreshPosition: true,
      refreshVisibility: true
    });
  }
  // The queued pass only sees the already invisible token at the end of a long move.
  enemy.visual = enemy.visible = false;
  enemy.position.x = 1800;
  enemy.mesh.position.x = 1850;
  enemy.animationContexts.clear();
  f.emit("refreshToken", enemy, {
    refreshPosition: true,
    refreshVisibility: true
  });
  f.frame();
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  const marker = root.children[0];
  assert.equal(marker.position.x, 500);
  assert.equal(marker.children[0].angle, 90);
  assert.equal(
    f.host.game.modules.get(MODULE_ID).api.getDiagnostics().failed,
    false
  );
  controller.dispose();
});

test("immediate native refresh sampling cannot observe Hidden tokens, special detection or another vision context", () => {
  const f = runtimeHost();
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  const root = () =>
    f.host.canvas.interface.children.find(
      child => child.name === "probably-just-a-rat-memory"
    );
  enemy.visual = false;
  enemy.position.x = 900;
  enemy.mesh.position.x = 950;
  f.emit("refreshToken", enemy, { refreshPosition: true });
  f.frame();
  assert.equal(root().children[0].position.x, 20);
  enemy.document.hidden = true;
  Object.defineProperty(enemy, "position", {
    get() {
      throw new Error("Hidden position read");
    }
  });
  f.emit("refreshToken", enemy, { refreshPosition: true });
  f.frame();
  assert.equal(root().children.length, 0);
  const other = token(f.host, "other");
  f.observer.allowed = false;
  f.emit("refreshToken", other, { refreshPosition: true });
  f.frame();
  const diagnostics = f.host.game.modules.get(MODULE_ID).api.getDiagnostics();
  assert.equal(diagnostics.failed, false);
  assert.equal(diagnostics.remembered, 0);
  assert.equal(diagnostics.markers, 0);
  controller.dispose();
});

test("SceneConfig's overland rule updates immediately and keeps known Hidden positions despite combat-only changes", async () => {
  const f = runtimeHost();
  let overland = false;
  f.host.canvas.scene.getFlag = (_namespace, key) =>
    key === "overlandMemory" && overland;
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  overland = true;
  f.emit("updateScene", f.host.canvas.scene);
  f.frame();
  enemy.document.hidden = true;
  enemy.visual = enemy.visible = false;
  f.emit("updateToken", enemy.document, { hidden: true });
  const diagnostics = () =>
    f.host.game.modules.get(MODULE_ID).api.getDiagnostics();
  assert.equal(diagnostics().remembered, 1);
  assert.equal(diagnostics().markers, 1);
  await f.host.game.settings.set(MODULE_ID, "combatOnly", true);
  f.frame();
  assert.equal(diagnostics().remembered, 1);
  assert.equal(diagnostics().markers, 1);
  assert.equal(f.timers.size, 0);
  overland = false;
  f.emit("updateScene", f.host.canvas.scene);
  f.frame();
  assert.equal(diagnostics().remembered, 0);
  assert.equal(diagnostics().markers, 0);
  assert.equal(diagnostics().failed, false);
  controller.dispose();
});

test("module loading before game.release exists still registers settings and the token tool", () => {
  const f = runtimeHost();
  const release = f.host.game.release;
  delete f.host.game.release;
  const controller = installModule(f.host);
  const earlyControls = { tokens: { tools: {} } };
  f.emit("getSceneControlButtons", earlyControls);
  assert.equal(earlyControls.tokens.tools[MODULE_ID], undefined);
  f.host.game.release = release;
  f.emit("init");
  f.emit("ready");
  f.frame();
  const controls = { tokens: { tools: {} } };
  f.emit("getSceneControlButtons", controls);
  assert.equal(f.settings.get("markerStyle").default, "ghost");
  assert.equal(controls.tokens.tools[MODULE_ID].visible, true);
  assert.equal(f.host.game.modules.get(MODULE_ID).api.stage, "observation");
  controller.dispose();
  assert.equal(f.listeners.size, 0);
});

test("bootstrap starts automatically with six client settings and eleven GM rules", () => {
  const f = runtimeHost();
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  assert.deepEqual(
    [...f.settings]
      .filter(([_key, setting]) => setting.config)
      .map(([key]) => key),
    [
      "language",
      "markerStyle",
      "customMarkerImage",
      "customMarkerRotate",
      "opacity",
      "grayscale",
      "outline",
      "outlineColor",
      "captionStyle",
      "labels",
      "sharePings",
      "showNames",
      "showRounds",
      "rememberHidden",
      "combatOnly",
      "memoryRounds",
      "memoryMinutes"
    ]
  );
  assert.equal(f.settings.size, 17);
  assert.equal(f.settings.get("rememberHidden").scope, "world");
  assert.equal(f.settings.get("rememberHidden").default, false);
  assert.equal(f.settings.get("markerStyle").scope, "world");
  assert.equal(f.settings.get("customMarkerImage").scope, "world");
  assert.equal(f.settings.get("combatOnly").scope, "world");
  assert.equal(f.settings.get("combatOnly").default, false);
  assert.equal(f.settings.get("memoryRounds").scope, "world");
  assert.equal(f.settings.get("memoryRounds").default, 2);
  assert.equal(f.settings.get("memoryMinutes").scope, "world");
  assert.equal(f.settings.get("memoryMinutes").default, 1);
  assert.equal(f.settings.get("showNames").scope, "world");
  assert.equal(
    [...f.settings.values()].filter(setting => setting.scope === "client")
      .length,
    6
  );
  assert.equal(f.settings.get("opacity").default, 50);
  assert.equal(f.settings.has("style"), false);
  assert.equal(f.settings.get("grayscale").default, 30);
  assert.equal(f.settings.get("showRounds").scope, "world");
  assert.equal(f.settings.get("sharePings").scope, "world");
  assert.equal(f.settings.get("sharePings").default, "true");
  assert.equal(f.settings.get("language").scope, "client");
  assert.equal(f.settings.get("language").default, "foundry");
  assert.equal(f.settings.has("showMarkers"), false);
  assert.equal(f.menus.size, 0);
  assert.equal("openMemory" in f.host.game.modules.get(MODULE_ID).api, false);
  const binding = f.bindings.get("clearMemory");
  assert.deepEqual(binding.editable, []);
  assert.equal(binding.restricted, false);
  assert.equal(binding.onDown(), true);
  assert.equal(f.host.game.modules.get(MODULE_ID).api.stage, "observation");
  assert.ok(
    [...f.listeners.values()].some(
      listener => listener.event === "sightRefresh"
    )
  );
  f.emit("canvasTearDown");
  controller.dispose();
  controller.dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.host.game.modules.get(MODULE_ID).api, undefined);
});

test("saved GM combat lifetime loads on ready and setting changes expire existing ghosts immediately", async () => {
  const f = runtimeHost();
  f.host.game.combat = {
    id: "fight",
    started: true,
    scene: null,
    round: 1,
    turn: 0
  };
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.settings.get("memoryRounds").value = 4;
  f.emit("ready");
  f.frame();
  enemy.visual = false;
  f.emit("refreshToken", enemy);
  f.frame();
  f.host.game.combat.round = 3;
  f.emit("updateCombat");
  f.frame();
  const api = f.host.game.modules.get(MODULE_ID).api.memory;
  assert.equal(api.list().length, 1);
  await f.host.game.settings.set(MODULE_ID, "memoryRounds", 2);
  assert.deepEqual(api.list(), []);
  assert.equal(f.timers.size, 0);
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  assert.equal(root.children.length, 0);
  controller.dispose();
});

test("combat-only setting immediately clears ghosts and API handles, and turning it off resumes outside combat", async () => {
  const f = runtimeHost();
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  enemy.visual = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const api = f.host.game.modules.get(MODULE_ID).api.memory;
  const saved = api.list()[0];
  assert.ok(saved);
  await f.host.game.settings.set(MODULE_ID, "combatOnly", true);
  assert.deepEqual(api.list(), []);
  assert.equal(await api.center(saved.id), false);
  assert.equal(f.host.canvas.interface.children.length, 0);
  f.frame();
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  await f.host.game.settings.set(MODULE_ID, "combatOnly", false);
  enemy.visual = true;
  f.frame();
  enemy.visual = false;
  f.emit("refreshToken", enemy);
  f.frame();
  assert.equal(api.list().length, 1);
  controller.dispose();
});

test("elapsed-round captions start on loss, follow combat updates and obey the GM rule without rebuilding art", async () => {
  const f = runtimeHost();
  f.host.game.combat = {
    id: "fight",
    started: true,
    scene: { id: "scene" },
    round: 1,
    turn: 0
  };
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  // The last observed snapshot is old, but the creature stayed visible until round 5.
  f.host.game.combat.round = 5;
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  const marker = root.children[0];
  const image = marker.children.find(child => child.name === "rat-ghost-image");
  const text = () =>
    marker.children.find(child => child.name === "rat-ghost-caption")
      .children[1].text;
  assert.equal(text(), "Known enemy\nRAT.LastPosition\nRAT.RoundsSinceLoss 0");
  const api = f.host.game.modules.get(MODULE_ID).api.memory;
  let updates = 0;
  api.subscribe(() => updates++);
  f.host.game.combat.round = 6;
  f.emit("updateCombat");
  f.frame();
  assert.equal(text(), "Known enemy\nRAT.LastPosition\nRAT.RoundsSinceLoss 1");
  assert.equal(api.list()[0].label, "RAT.RoundsSinceLoss 1");
  assert.ok(updates > 0);
  f.host.game.combat.round = 4;
  f.emit("updateCombat");
  f.frame();
  assert.equal(text(), "Known enemy\nRAT.LastPosition\nRAT.RoundsSinceLoss 1");
  await f.host.game.settings.set(MODULE_ID, "showRounds", false);
  f.frame();
  assert.equal(text(), "Known enemy\nRAT.LastPosition");
  assert.equal(api.list()[0].label, "RAT.LastPosition");
  assert.equal(
    marker.children.find(child => child.name === "rat-ghost-image"),
    image
  );
  await f.host.game.settings.set(MODULE_ID, "showRounds", true);
  f.frame();
  assert.equal(text(), "Known enemy\nRAT.LastPosition\nRAT.RoundsSinceLoss 1");
  controller.dispose();
});

test("SettingsConfig hooks preview cached art without saving or reading hidden tokens and restore on close", () => {
  const f = runtimeHost();
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  const image = () =>
    root.children[0].children.find(child => child.name === "rat-ghost-image");
  Object.defineProperty(enemy.document, "hidden", {
    get() {
      throw new Error("Preview must not resample hidden state");
    }
  });
  const app = {},
    form = new EventTarget();
  form.querySelector = () => null;
  f.emit("renderSettingsConfig", app, form);
  const input = (key, value) => {
    const event = new Event("input");
    Object.defineProperty(event, "target", {
      value: {
        tagName: "INPUT",
        value,
        closest: () => ({ getAttribute: () => `${MODULE_ID}.${key}` })
      }
    });
    form.dispatchEvent(event);
  };
  input("opacity", "35");
  input("grayscale", "100");
  f.frame();
  assert.equal(image().alpha, 0.35);
  assert.equal(image().filters[0].monochrome, true);
  assert.equal(f.settings.get("opacity").value, 50);
  assert.equal(f.settings.get("grayscale").value, 30);
  input("opacity", "70");
  f.emit("closeSettingsConfig", app);
  f.frame();
  assert.equal(image().alpha, 0.5);
  assert.equal(image().filters[0].amount, -0.3);
  input("opacity", "10");
  assert.equal(f.frames.size, 0);
  controller.dispose();
});

test("native hook wiring observes automatically, clears from the unassigned action and frees resources", () => {
  const f = runtimeHost();
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  const root = () =>
    f.host.canvas.interface.children.find(
      child => child.name === "probably-just-a-rat-memory"
    );
  assert.equal(root().children.length, 0);
  enemy.visual = false;
  enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  assert.equal(root().children.length, 1);
  assert.equal(f.timers.size, 1);
  f.bindings.get("clearMemory").onDown();
  assert.equal(f.host.canvas.interface.children.length, 0);
  f.frame();
  assert.equal(f.timers.size, 0);
  f.emit("sightRefresh");
  f.frame();
  assert.equal(root().children.length, 0);
  controller.dispose();
  assert.equal(f.host.canvas.interface.children.length, 0);
  assert.equal(f.listeners.size, 0);
});

test("unrelated user and selection updates preserve memory while changed vision permissions clear it", () => {
  const f = runtimeHost();
  const enemy = token(f.host);
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const api = f.host.game.modules.get(MODULE_ID).api;
  for (const changes of [
    { hotbar: { 1: "macro" } },
    { color: "#ffffff" },
    { name: "Renamed" }
  ]) {
    f.emit("updateUser", f.host.game.user, changes);
    f.frame();
    assert.equal(api.getDiagnostics().remembered, 1);
  }
  f.emit("controlToken", enemy, false);
  f.frame();
  assert.equal(api.getDiagnostics().remembered, 1);
  f.observer.allowed = false;
  f.emit("updateUser", f.host.game.user, { permissions: {} });
  f.frame();
  assert.equal(api.getDiagnostics().remembered, 0);
  controller.dispose();
});

test("ready binds already rendered combat tracker and popout once and disposal releases both", () => {
  const f = runtimeHost();
  const makeApp = () => {
    const listeners = new Set();
    return {
      rendered: true,
      listeners,
      element: {
        addEventListener: (_event, listener) => listeners.add(listener),
        removeEventListener: (_event, listener) => listeners.delete(listener)
      }
    };
  };
  const app = makeApp();
  app.popout = makeApp();
  f.host.ui.combat = app;
  const controller = installModule(f.host);
  f.emit("init");
  f.emit("renderCombatTracker", app, app.element);
  f.emit("ready");
  assert.equal(app.listeners.size, 1);
  assert.equal(app.popout.listeners.size, 1);
  f.emit("renderCombatTracker", app, app.element);
  assert.equal(app.listeners.size, 1);
  controller.dispose();
  assert.equal(app.listeners.size, 0);
  assert.equal(app.popout.listeners.size, 0);
});

test("native Hidden hook preserves only known memory when the GM rule is enabled and clears it when disabled", async () => {
  const f = runtimeHost();
  const controller = installModule(f.host);
  const enemy = token(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  await f.host.game.settings.set(MODULE_ID, "rememberHidden", true);
  f.frame();
  enemy.document.hidden = true;
  f.emit("updateToken", enemy.document, { hidden: true });
  const api = f.host.game.modules.get(MODULE_ID).api.memory;
  assert.equal(api.list().length, 1);
  f.frame();
  assert.equal(api.list().length, 1);
  enemy.document.hidden = false;
  f.emit("updateToken", enemy.document, { hidden: false });
  f.frame();
  assert.equal(api.list().length, 0);
  await f.host.game.settings.set(MODULE_ID, "rememberHidden", false);
  f.frame();
  enemy.document.hidden = true;
  f.emit("updateToken", enemy.document, { hidden: true });
  assert.equal(api.list().length, 0);
  f.frame();
  assert.equal(api.list().length, 0);
  controller.dispose();
});

test("unsupported Foundry generation leaves the canvas integration inactive", () => {
  const f = runtimeHost();
  f.host.game.release.generation = 13;
  installModule(f.host);
  f.emit("init");
  f.emit("ready");
  assert.equal(f.warnings.length, 1);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.host.game.modules.get(MODULE_ID).api, undefined);
  const controls = { tokens: { tools: {} } };
  f.emit("getSceneControlButtons", controls);
  assert.deepEqual(controls.tokens.tools, {});
});

test("disposal before initialization prevents deferred installation", () => {
  const f = runtimeHost();
  installModule(f.host).dispose();
  f.emit("init");
  f.emit("ready");
  assert.equal(f.settings.size, 0);
  assert.equal(f.listeners.size, 0);
});
