import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppearance } from "../scripts/appearance.js";
import {
  registerSettings,
  migrateOpacity,
  memoryPolicy,
  sceneMemoryMode,
  sceneRetainsMemory
} from "../scripts/settings.js";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { installModule } from "../scripts/lifecycle.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";
import { MODULE_ID } from "../scripts/constants.js";

test("native NumberField validation rejects invalid writes without replacing the saved durations", async () => {
  const f = runtimeHost();
  // The boundary models Foundry's validate-before-write contract. It does not
  // emulate native rendering or claim a live Foundry save was exercised.
  class NumberField {
    constructor(options) {
      this.options = options;
    }
  }
  registerSettings(
    f.host.game.settings,
    () => {},
    undefined,
    undefined,
    NumberField
  );
  const write = f.host.game.settings.set;
  f.host.game.settings.set = async (namespace, key, value) => {
    const field = f.settings.get(key).type;
    if (!field.options.validate(value))
      throw new Error(field.options.validationError);
    return write(namespace, key, value);
  };
  for (const key of ["memoryRounds", "memoryMinutes"]) {
    const field = f.settings.get(key).type;
    assert.equal(field.options.integer, false);
    assert.equal(field.options.nullable, false);
    const saved = f.host.game.settings.get(MODULE_ID, key);
    for (const invalid of [0, -5, NaN, Infinity, "", null]) {
      await assert.rejects(f.host.game.settings.set(MODULE_ID, key, invalid), {
        message: `RAT.Settings.${key}.Validation`
      });
      assert.equal(f.host.game.settings.get(MODULE_ID, key), saved);
    }
  }
  await assert.rejects(
    f.host.game.settings.set(MODULE_ID, "memoryRounds", 1.5)
  );
  await assert.rejects(
    f.host.game.settings.set(MODULE_ID, "memoryMinutes", Number.MAX_VALUE)
  );
  await f.host.game.settings.set(MODULE_ID, "memoryRounds", 3);
  await f.host.game.settings.set(MODULE_ID, "memoryMinutes", 0.25);
  assert.equal(memoryPolicy(f.host.game.settings).combatRounds, 3);
  assert.equal(memoryPolicy(f.host.game.settings).seconds, 15);
});

test("explicit scene modes override legacy overland flags without losing legacy compatibility", () => {
  const scene = (memoryMode, overlandMemory) => ({
    getFlag: (_module, key) => ({ memoryMode, overlandMemory })[key]
  });
  assert.equal(sceneMemoryMode(undefined), "world");
  assert.equal(sceneMemoryMode(scene(undefined, true)), "long");
  assert.equal(sceneMemoryMode(scene("broken", true)), "long");
  assert.equal(sceneMemoryMode(scene("world", true)), "world");
  assert.equal(sceneMemoryMode(scene("disabled", true)), "disabled");
  assert.equal(sceneRetainsMemory(scene("disabled", true)), false);
  assert.equal(sceneRetainsMemory(scene("long", false)), true);
});

test("memory durations accept positive rounds and fractional minutes, falling back safely for malformed values", () => {
  const f = runtimeHost();
  registerSettings(f.host.game.settings, () => {});
  assert.deepEqual(memoryPolicy(f.host.game.settings), {
    retainUntilRediscovered: false,
    combatRounds: 2,
    seconds: 60
  });
  f.settings.get("memoryRounds").value = 5;
  f.settings.get("memoryMinutes").value = 0.5;
  assert.deepEqual(memoryPolicy(f.host.game.settings), {
    retainUntilRediscovered: false,
    combatRounds: 5,
    seconds: 30
  });
  for (const invalid of [0, -1, NaN, Infinity, "invalid", null]) {
    f.settings.get("memoryRounds").value = invalid;
    f.settings.get("memoryMinutes").value = invalid;
    assert.deepEqual(memoryPolicy(f.host.game.settings), {
      retainUntilRediscovered: false,
      combatRounds: 2,
      seconds: 60
    });
  }
  f.settings.get("memoryRounds").value = 1.5;
  f.settings.get("memoryMinutes").value = Number.MAX_VALUE;
  assert.deepEqual(memoryPolicy(f.host.game.settings), {
    retainUntilRediscovered: false,
    combatRounds: 2,
    seconds: 60
  });
});

test("legacy alpha migrates once to equivalent percent and appearance clamps malformed values", async () => {
  const f = runtimeHost();
  let changes = 0;
  registerSettings(f.host.game.settings, () => changes++);
  f.settings.get("opacity").value = 0.45;
  await migrateOpacity(f.host.game.settings);
  assert.equal(f.settings.get("opacity").value, 45);
  await migrateOpacity(f.host.game.settings);
  assert.equal(changes, 1);
  assert.equal(
    resolveAppearance({ opacity: 0.45, grayscale: 0, labels: false }).opacity,
    0.45
  );
  assert.equal(
    resolveAppearance({ opacity: 900, grayscale: NaN, labels: true }).opacity,
    0.8
  );
  assert.equal(
    resolveAppearance({ opacity: -50, grayscale: NaN, labels: true }).opacity,
    0.3
  );
  assert.equal(
    resolveAppearance({ opacity: NaN, grayscale: NaN, labels: true }).grayscale,
    0.3
  );
  assert.equal(
    resolveAppearance({ opacity: 50, grayscale: 500, labels: true }).grayscale,
    1
  );
  assert.equal(
    resolveAppearance({ opacity: 50, grayscale: -1, labels: true }).grayscale,
    0
  );
});

test("grayscale changes rebuild the same frozen image without observing hidden state or adding a ticker", async () => {
  const f = runtimeHost();
  const store = new MemoryStore();
  const tracker = new ObservationTracker(f.host, store);
  registerSettings(f.host.game.settings, () => {
    tracker.renderer.rebuild();
    tracker.schedule();
  });
  const enemy = token(f.host);
  const nativeTexture = enemy.texture;
  tracker.schedule();
  f.frame();
  const snapshot = store.get("enemy").snapshot;
  const ownedTexture = tracker.renderer.textures.get("enemy").texture;
  enemy.visible = enemy.visual = false;
  tracker.schedule(enemy);
  f.frame();
  const oldCaption = tracker.renderer.markers.get("enemy").caption;
  const oldText = oldCaption.children[1];
  Object.defineProperty(enemy, "texture", {
    get() {
      throw new Error("Hidden image was read");
    }
  });
  for (const grayscale of [0, 50, 100]) {
    await f.host.game.settings.set(MODULE_ID, "grayscale", grayscale);
    await f.host.game.settings.set(MODULE_ID, "opacity", 50);
    await f.host.game.settings.set(MODULE_ID, "captionStyle", "off");
    f.frame();
    assert.equal(tracker.failed, false);
    assert.equal(store.get("enemy").snapshot, snapshot);
    const marker = tracker.renderer.markers.get("enemy").container;
    const image = marker.children.find(
      child => child.name === "rat-ghost-image"
    );
    assert.equal(image.texture, ownedTexture);
    assert.equal(image.alpha, 0.5);
    assert.equal(marker.position.x, snapshot.x);
    assert.equal(image.mask, undefined);
    assert.equal(image.filters?.length ?? 0, grayscale > 0 ? 1 : 0);
    if (grayscale > 0) assert.equal(image.filters[0].amount, -grayscale / 100);
    assert.equal(
      marker.children.some(child => child.name === "rat-ghost-caption"),
      false
    );
    assert.equal(marker.eventMode, "none");
    assert.equal(marker.interactiveChildren, false);
    assert.equal(f.frames.size, 0);
  }
  const finalFilters = [...tracker.renderer.markers.get("enemy").filters];
  assert.equal(finalFilters.length, 1);
  tracker.suspend();
  assert.ok(finalFilters.every(filter => filter.destroyed));
  assert.equal(oldText.destroyed, true);
  assert.equal(oldText.destroyOptions.texture, true);
  assert.equal(oldText.destroyOptions.baseTexture, true);
  assert.equal(ownedTexture.destroyed, true);
  assert.equal(nativeTexture.destroyed, false);
});

test("retired world options remain absent and diagnostics are session-only", () => {
  const f = runtimeHost();
  const controller = installModule(f.host);
  const enemy = token(f.host);
  f.host.game.user.isGM = true;
  f.observer.controlled = true;
  enemy.document.isOwner = true; // Native TokenDocument.isOwner is always true for a GM.
  f.emit("init");
  f.emit("ready");
  f.frame();
  for (const key of [
    "enabled",
    "candidates",
    "combatRounds",
    "seconds",
    "clearOnCombatEnd",
    "diagnostics"
  ])
    assert.equal(f.settings.has(key), false);
  const api = f.host.game.modules.get(MODULE_ID).api;
  assert.equal(api.getDiagnostics().enabled, false);
  api.startDiagnostics();
  enemy.visual = false;
  f.emit("refreshToken", enemy);
  f.frame();
  assert.equal(
    api.getDiagnostics().samples.at(-1).reason,
    "visual-detection-failed"
  );
  assert.equal(
    f.host.canvas.interface.children.find(
      child => child.name === "probably-just-a-rat-memory"
    ).children.length,
    1
  );
  api.stopDiagnostics();
  assert.equal(api.getDiagnostics().enabled, false);
  assert.deepEqual(api.getDiagnostics().samples, []);
  controller.dispose();
});
