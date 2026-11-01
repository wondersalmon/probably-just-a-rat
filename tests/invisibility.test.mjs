import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";

// Reduced v14/PF2e/SF2e boundary contract, not a simulation of native LOS.
function fixture() {
  const f = runtimeHost();
  registerSettings(f.host.game.settings, () => {});
  const store = new MemoryStore({ now: () => 0 });
  const tracker = new ObservationTracker(f.host, store);
  const enemy = token(f.host);
  enemy.invisible = true;
  f.source.illuminated = true;
  f.source.darkvision = false;
  f.source.lineOfSight = true;
  f.source.inRange = true;
  f.observer.document.detectionModes.seeInvisibility = { enabled: true };
  const canSee = (source, mode) =>
    mode.enabled && !source.isBlinded && source.lineOfSight;
  const modes = f.host.CONFIG.Canvas.detectionModes;
  modes.basicSight.testVisibility = (source, mode, config) =>
    canSee(source, mode) && !config.object?.invisible && source.darkvision;
  modes.lightPerception.testVisibility = (source, mode, config) =>
    canSee(source, mode) && !config.object?.invisible && source.illuminated;
  modes.seeInvisibility = {
    testVisibility: (source, mode, config) =>
      canSee(source, mode) && source.inRange && config.object?.invisible
  };
  const update = () => {
    tracker.schedule();
    f.frame();
    assert.equal(tracker.failed, false);
  };
  return { ...f, enemy, store, tracker, update };
}

test("See Invisibility rediscovers a remembered enemy and freezes its last seen movement when lost", () => {
  const f = fixture();
  f.observer.document.detectionModes.seeInvisibility.enabled = false;
  f.enemy.invisible = false;
  f.update();
  f.enemy.invisible = true;
  f.update();
  assert.equal(f.tracker.renderer.markers.size, 1);
  f.enemy.position.x = 100;
  f.enemy.mesh.position.x = 150;
  f.observer.document.detectionModes.seeInvisibility.enabled = true;
  f.update();
  assert.equal(f.store.get("enemy").state, "observed");
  assert.equal(f.store.get("enemy").snapshot.x, 100);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.source.lineOfSight = false;
  f.enemy.position.x = 200;
  f.enemy.mesh.position.x = 250;
  f.update();
  assert.equal(f.store.get("enemy").state, "remembered");
  assert.equal(f.store.get("enemy").snapshot.x, 100);
  assert.equal(f.tracker.renderer.markers.size, 1);
  f.tracker.suspend();
});

for (const [name, change, observed] of [
  ["illuminated target", () => {}, true],
  ["darkness without darkvision", f => (f.source.illuminated = false), false],
  [
    "darkness with darkvision",
    f => {
      f.source.illuminated = false;
      f.source.darkvision = true;
    },
    true
  ],
  ["wall", f => (f.source.lineOfSight = false), false],
  ["out of detection range", f => (f.source.inRange = false), false],
  ["blinded observer", f => (f.source.isBlinded = true), false],
  ["GM Hidden", f => (f.enemy.document.hidden = true), false],
  ["unrendered mesh", f => (f.enemy.mesh.renderable = false), false],
  [
    "disabled See Invisibility",
    f => (f.observer.document.detectionModes.seeInvisibility.enabled = false),
    false
  ],
  [
    "missing See Invisibility implementation",
    f => delete f.host.CONFIG.Canvas.detectionModes.seeInvisibility,
    false
  ]
]) {
  test(`See Invisibility respects ${name}`, () => {
    const f = fixture();
    change(f);
    f.update();
    assert.equal(f.store.get("enemy")?.state === "observed", observed);
    f.tracker.suspend();
  });
}

test("hearing, tremorsense and Sense Invisibility cannot substitute for visual observation", () => {
  const f = fixture();
  delete f.observer.document.detectionModes.seeInvisibility;
  for (const id of ["hearing", "feelTremor", "senseInvisibility", "senseAll"]) {
    f.observer.document.detectionModes[id] = { enabled: true };
    f.host.CONFIG.Canvas.detectionModes[id] = {
      testVisibility: () => {
        throw new Error("Nonvisual detection must not be sampled");
      }
    };
  }
  f.update();
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("See Invisibility and illumination must belong to the same observer", () => {
  const f = fixture();
  f.source.illuminated = false;
  const ally = token(f.host, "ally");
  ally.document.disposition = 1;
  ally.document.detectionModes = {
    basicSight: { enabled: true },
    lightPerception: { enabled: true }
  };
  f.host.canvas.effects.visionSources.set("ally-source", {
    ...f.source,
    object: ally,
    illuminated: true
  });
  ally.actor = { testUserPermission: () => true };
  f.update();
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("See Invisibility and illumination must overlap at the same test point", () => {
  const f = fixture();
  f.enemy.document.getVisibilityTestPoints = () => [
    { x: 50, y: 50 },
    { x: 150, y: 50 }
  ];
  const modes = f.host.CONFIG.Canvas.detectionModes;
  modes.seeInvisibility.testVisibility = (_source, mode, config) =>
    mode.enabled && config.tests.some(test => test.point.x === 50);
  modes.lightPerception.testVisibility = (_source, mode, config) =>
    mode.enabled &&
    config.object === null &&
    config.tests.some(test => test.point.x === 150);
  f.update();
  assert.equal(f.store.size, 0);
  modes.lightPerception.testVisibility = (_source, mode, config) =>
    mode.enabled &&
    config.object === null &&
    config.tests.some(test => test.point.x === 50);
  f.update();
  assert.equal(f.store.get("enemy").state, "observed");
  f.tracker.suspend();
});
