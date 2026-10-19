import assert from "node:assert/strict";
import test from "node:test";
import { CombatMemoryPing } from "../scripts/combat-memory-ping.js";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";
const MODULE_ID = "probably-just-a-rat";
function fixture(combat = null) {
  const f = runtimeHost();
  f.host.game.combat = combat;
  const tracker = new ObservationTracker(f.host, new MemoryStore());
  registerSettings(f.host.game.settings, () => {});
  const enemy = token(f.host);
  enemy.nameplate.visible = true;
  tracker.schedule();
  f.frame();
  enemy.visible = enemy.visual = false;
  tracker.schedule(enemy);
  f.frame();
  enemy.position.x = 1500;
  const combatant = {
    sceneId: "scene",
    tokenId: "enemy",
    get token() {
      throw new Error("Hidden token was accessed");
    }
  };
  const local = [],
    shared = [];
  f.host.canvas.controls = { handlePing: (...args) => local.push(args) };
  f.host.canvas.ping = (...args) => shared.push(args);
  const ping = new CombatMemoryPing(f.host, tracker);
  const event = {
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    }
  };
  return { ...f, tracker, enemy, combatant, local, shared, ping, event };
}
for (const transition of ["expiry", "end", "replacement"])
  test(`tracker ping rejects combat ${transition} before the next observation frame`, () => {
    const f = fixture({
      id: "fight",
      started: true,
      scene: null,
      round: 1,
      turn: 0
    });
    assert.equal(f.tracker.store.remembered().length, 1);
    if (transition === "expiry") f.host.game.combat.round = 3;
    else if (transition === "end") f.host.game.combat = null;
    else f.host.game.combat.id = "replacement";
    f.tracker.schedule(); // Native hooks have queued work, but no frame ran yet.
    assert.equal(f.ping.handle(f.event, f.combatant), false);
    assert.equal(f.shared.length + f.local.length, 0);
    assert.equal(f.tracker.store.remembered().length, 0);
    f.tracker.suspend();
  });

test("tracker ping shares the remembered center by default and can be switched to local", async () => {
  const f = fixture();
  assert.equal(f.ping.handle(f.event, f.combatant), true);
  assert.deepEqual(f.shared[0], [{ x: 70, y: 80 }]);
  assert.equal(f.local.length, 0);
  assert.equal(f.event.stopped, true);
  assert.equal(f.event.prevented, true);
  await f.host.game.settings.set(MODULE_ID, "sharePings", false);
  f.ping.handle(f.event, f.combatant);
  assert.deepEqual(f.local[0][1], { x: 70, y: 80 });
  assert.equal(f.local[0][2].pull, false);
  assert.equal(f.local[0][2].style, "pulse");
  assert.equal(
    f.tracker.renderer.caption(f.tracker.store.get("enemy")),
    "Known enemy\nRAT.LastPosition"
  );
  f.tracker.suspend();
});

test("ping audience preserves saved booleans and native String casts without broadcasting local choices", async () => {
  const f = fixture();
  assert.equal(f.settings.get("sharePings").type, String);
  assert.equal(f.settings.get("sharePings").scope, "world");
  assert.deepEqual(Object.keys(f.settings.get("sharePings").choices), [
    "false",
    "true"
  ]);
  for (const [value, shared] of [
    [false, false],
    ["false", false],
    [true, true],
    ["true", true],
    ["invalid", false]
  ]) {
    f.local.length = f.shared.length = 0;
    await f.host.game.settings.set(MODULE_ID, "sharePings", value);
    assert.equal(
      f.shared.length,
      0,
      "changing the audience must not send a ping"
    );
    assert.equal(
      f.frames.size,
      0,
      "changing the audience must not resample tokens"
    );
    assert.equal(f.ping.handle(f.event, f.combatant), true);
    assert.equal(f.shared.length, shared ? 1 : 0);
    assert.equal(f.local.length, shared ? 0 : 1);
  }
  f.tracker.suspend();
});
test("unknown/visible targets and invalid permissions/context leave native actions untouched", () => {
  const f = fixture();
  assert.equal(
    f.ping.handle(f.event, { sceneId: "scene", tokenId: "unknown" }),
    false
  );
  assert.equal(
    f.ping.handle(f.event, { sceneId: "other", tokenId: "enemy" }),
    false
  );
  f.host.game.user.hasPermission = () => false;
  assert.equal(f.ping.handle(f.event, f.combatant), false);
  f.host.game.user.hasPermission = () => true;
  f.observer.allowed = false;
  assert.equal(f.ping.handle(f.event, f.combatant), false);
  f.observer.allowed = true;
  f.enemy.visible = f.enemy.visual = true;
  f.enemy.position.x = 20;
  f.tracker.schedule(f.enemy);
  f.frame();
  assert.equal(f.ping.handle(f.event, f.combatant), false);
  assert.equal(f.event.stopped, false);
  assert.equal(f.shared.length + f.local.length, 0);
  f.tracker.suspend();
});

test("native ping failures are reported without releasing the click to a hidden token action", async () => {
  const f = fixture();
  await f.host.game.settings.set(MODULE_ID, "sharePings", false);
  f.host.canvas.controls.handlePing = () => {
    throw new Error("native ping unavailable");
  };
  assert.equal(f.ping.handle(f.event, f.combatant), true);
  assert.equal(f.event.stopped, true);
  assert.deepEqual(f.warnings, ["RAT.PingFailed"]);
  await f.host.game.settings.set(MODULE_ID, "sharePings", true);
  f.host.canvas.ping = () => Promise.reject(new Error("activity failed"));
  f.ping.handle(f.event, f.combatant);
  await Promise.resolve();
  assert.equal(f.warnings.length, 2);
  f.tracker.suspend();
});
test("repeated tracker renders replace one capture listener and disposal releases it", () => {
  const f = fixture();
  const listeners = new Map();
  const root = {
    addEventListener: (_event, fn, capture) => listeners.set(fn, capture),
    removeEventListener: (_event, fn) => listeners.delete(fn)
  };
  const app = { viewed: { combatants: new Map([["combatant", f.combatant]]) } };
  f.ping.mount(app, root);
  f.ping.mount(app, root);
  assert.equal(listeners.size, 1);
  assert.equal([...listeners.values()][0], true);
  const target = {
    closest: selector =>
      selector.includes("data-action")
        ? target
        : { getAttribute: () => "combatant" }
  };
  [...listeners.keys()][0]({ ...f.event, target });
  assert.equal(f.shared.length, 1);
  f.ping.dispose();
  assert.equal(listeners.size, 0);
  f.tracker.suspend();
});

test("local pings retain native SHIFT/ALT styles, pull and current zoom; shared pings pass no overrides", async () => {
  const f = fixture();
  await f.host.game.settings.set(MODULE_ID, "sharePings", false);
  for (const [shift, alt, style] of [
    [false, false, "pulse"],
    [false, true, "alert"],
    [true, false, "pull"],
    [true, true, "pull"]
  ]) {
    f.host.game.keyboard = {
      isModifierActive: key => (key === "SHIFT" ? shift : alt)
    };
    f.ping.handle(f.event, f.combatant);
    assert.deepEqual(f.local.at(-1)[2], {
      scene: "scene",
      style,
      pull: shift,
      zoom: 1.25
    });
    await f.host.game.settings.set(MODULE_ID, "sharePings", true);
    f.ping.handle(f.event, f.combatant);
    assert.deepEqual(f.shared.at(-1), [{ x: 70, y: 80 }]);
    await f.host.game.settings.set(MODULE_ID, "sharePings", false);
  }
  delete f.host.game.keyboard;
  f.ping.handle({ ...f.event, altKey: true }, f.combatant);
  assert.equal(f.local.at(-1)[2].style, "alert");
  f.ping.handle({ ...f.event, shiftKey: true }, f.combatant);
  assert.equal(f.local.at(-1)[2].pull, true);
  f.tracker.suspend();
});
