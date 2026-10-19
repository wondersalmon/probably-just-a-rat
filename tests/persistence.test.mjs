import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { LocalMemoryCache } from "../scripts/local-memory-cache.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";

const context = {
  sceneId: "scene",
  userId: "player",
  levelId: "floor",
  sourceIds: ["hero"],
  mode: "basic",
  permissionKey: "owner"
};
const visual = {
  x: 20,
  y: 30,
  width: 100,
  height: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  levelId: "floor",
  texture: "seen.webp",
  name: "Observed name"
};
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function storage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}
function boot(localStorage) {
  const f = runtimeHost();
  f.host.game.world = { id: "world" };
  f.host.localStorage = localStorage;
  f.host.canvas.app.renderer.extract = {
    canvas: () => ({ toDataURL: () => png })
  };
  const store = new MemoryStore();
  const tracker = new ObservationTracker(f.host, store);
  tracker.renderer.decodeImage = async () =>
    f.host.canvas.app.renderer.generateTexture();
  registerSettings(f.host.game.settings, () => tracker.schedule());
  const enemy = token(f.host);
  return {
    ...f,
    store,
    tracker,
    enemy,
    update() {
      tracker.schedule();
      f.frame();
    }
  };
}

test("checkpoint preserves remaining real-time lifetime across a reset monotonic clock", () => {
  let time = 100000;
  const old = new MemoryStore({ now: () => time });
  old.setContext(context);
  old.observe("enemy", visual);
  time += 1000;
  old.loseSight("enemy");
  time += 1000;
  const saved = old.checkpoint();
  assert.equal(saved.records[0].ageMs, 1000);
  assert.equal(saved.records[0].seenAgeMs, 2000);
  assert.equal(saved.records[0].snapshot.texture, null);
  let freshTime = 0;
  const restored = new MemoryStore({ now: () => freshTime });
  restored.setContext(context);
  restored.restore(saved, 10000);
  assert.equal(restored.get("enemy").state, "remembered");
  assert.equal(restored.get("enemy").snapshot.x, 20);
  freshTime = 48999;
  assert.equal(restored.size, 1);
  freshTime = 49000;
  assert.equal(restored.get("enemy"), undefined);
});

test("checkpoint of an idle visible token starts with zero memory age but retains observation time", () => {
  let time = 0;
  const old = new MemoryStore({ now: () => time });
  old.setContext(context);
  old.observe("enemy", visual);
  time = 600000;
  const saved = old.checkpoint();
  assert.equal(saved.records[0].ageMs, 0);
  assert.equal(saved.records[0].seenAgeMs, 600000);
  const restored = new MemoryStore({ now: () => time });
  restored.setContext(context);
  restored.restore(saved, 1000);
  assert.equal(restored.get("enemy").state, "remembered");
  time += 58999;
  restored.loseSight("enemy");
  assert.ok(restored.get("enemy"));
  time += 1;
  assert.equal(restored.get("enemy"), undefined);
});

test("restore rejects other contexts/combat and skips corrupt entries without accepting unknown fields", () => {
  const old = new MemoryStore();
  old.setContext(context);
  old.observe("enemy", visual);
  const saved = old.checkpoint();
  const other = new MemoryStore();
  other.setContext({ ...context, userId: "other" });
  other.restore(saved, 0);
  assert.equal(other.size, 0);
  other.setContext(context);
  other.setCombat({ id: "new-combat", round: 1, turn: 0 });
  other.restore(saved, 0);
  assert.equal(other.size, 0);
  const same = new MemoryStore();
  same.setContext(context);
  saved.records.unshift({
    ...saved.records[0],
    tokenId: "corrupt",
    snapshot: { ...visual, x: NaN }
  });
  saved.records[1].snapshot.actor = { hiddenHealth: 1 };
  same.restore(saved, 0);
  assert.equal(same.get("corrupt"), undefined);
  assert.equal(same.get("enemy").snapshot.actor, undefined);
  assert.equal(same.get("enemy").snapshot.name, "Observed name");
});

test("combat round high-water survives reload and cannot extend memory after rewind", () => {
  const old = new MemoryStore();
  old.setContext(context);
  old.setCombat({ id: "fight", round: 8, turn: 0 });
  old.setCombat({ id: "fight", round: 3, turn: 0 });
  old.observe("enemy", visual);
  const saved = old.checkpoint();
  const fresh = new MemoryStore();
  fresh.setContext(context);
  fresh.setCombat({ id: "fight", round: 3, turn: 0 });
  fresh.restore(saved, 20000);
  fresh.setCombat({ id: "fight", round: 9, turn: 0 });
  assert.equal(fresh.get("enemy").snapshot.combat.round, 3);
  fresh.setCombat({ id: "fight", round: 10, turn: 0 });
  assert.equal(fresh.size, 0);
});

test("F5 restores frozen position/name/pixels without reading a hidden token, and forget cannot resurrect it", async () => {
  const data = storage();
  const a = boot(data);
  a.enemy.nameplate.visible = true;
  a.update();
  a.enemy.visible = a.enemy.visual = false;
  a.update();
  a.tracker.checkpoint(true); // beforeunload; old page is discarded without scene teardown.
  assert.equal(data.values.size, 1);
  const b = boot(data);
  b.enemy.position.x = 1500;
  b.enemy.visible = b.enemy.visual = false;
  Object.defineProperty(b.enemy, "texture", {
    get() {
      throw new Error("Hidden texture read");
    }
  });
  b.update();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(b.tracker.failed, false);
  assert.equal(b.store.get("enemy").snapshot.x, 20);
  assert.equal(b.store.get("enemy").snapshot.name, "Known enemy");
  assert.equal(b.tracker.renderer.savedImage("enemy"), png);
  const marker = b.tracker.renderer.markers.get("enemy");
  assert.equal(marker.container.position.x, 20);
  assert.ok(
    marker.container.children.some(child => child.name === "rat-ghost-image")
  );
  b.tracker.forget("enemy");
  assert.equal(data.values.size, 0);
  const c = boot(data);
  c.enemy.visible = c.enemy.visual = false;
  c.update();
  assert.equal(c.store.size, 0);
  a.tracker.suspend();
  b.tracker.suspend();
  c.tracker.suspend();
});

test("combat-only reload outside combat discards the previous combat checkpoint", async () => {
  const data = storage();
  const a = boot(data);
  a.host.game.combat = {
    id: "fight",
    started: true,
    scene: null,
    round: 1,
    turn: 0
  };
  a.update();
  a.enemy.visible = a.enemy.visual = false;
  a.update();
  assert.equal(data.values.size, 1);
  const b = boot(data);
  await b.host.game.settings.set("probably-just-a-rat", "combatOnly", true);
  b.enemy.visible = b.enemy.visual = false;
  b.update();
  assert.equal(b.store.size, 0);
  assert.equal(b.tracker.renderer.markers.size, 0);
  assert.equal(data.values.size, 0);
  a.tracker.suspend();
  b.tracker.suspend();
});

test("late cached image decode cannot recreate a marker after context invalidation", async () => {
  const data = storage();
  const a = boot(data);
  a.update();
  a.enemy.visible = a.enemy.visual = false;
  a.update();
  const b = boot(data);
  let finish;
  b.tracker.renderer.decodeImage = () =>
    new Promise(resolve => {
      finish = resolve;
    });
  b.enemy.visible = b.enemy.visual = false;
  b.update();
  b.tracker.suspend();
  const decoded = b.host.canvas.app.renderer.generateTexture();
  finish(decoded);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(decoded.destroyed, true);
  assert.equal(b.tracker.renderer.markers.size, 0);
  assert.equal(data.values.size, 0);
  a.tracker.suspend();
});

test("quota/corrupt storage and clock rollback do not disable live tracking", () => {
  const data = storage();
  const f = boot(data);
  data.setItem = () => {
    throw new Error("quota");
  };
  f.update();
  f.tracker.checkpoint(true);
  f.tracker.checkpoint(true);
  assert.equal(f.tracker.failed, false);
  assert.equal(f.warnings.length, 1);
  data.setItem = (key, value) => data.values.set(key, value);
  const cache = new LocalMemoryCache(f.host, () => 1000);
  data.setItem(cache.key(), "{bad-json");
  assert.equal(cache.read("context"), null);
  data.setItem(
    cache.key(),
    JSON.stringify({
      version: 1,
      savedAt: 2000,
      state: { contextKey: "context" }
    })
  );
  assert.equal(cache.read("context"), null);
  assert.equal(data.values.size, 0);
  f.tracker.suspend();
});

test("saved PNG decode owns independent textures and cannot load document/network image URLs", async () => {
  const f = boot(storage());
  const sources = [];
  f.host.document.createElement = tag => {
    assert.equal(tag, "img");
    return {
      naturalWidth: 1,
      naturalHeight: 1,
      decode: async () => {},
      set src(value) {
        sources.push(value);
      }
    };
  };
  f.host.PIXI.BaseTexture = class {
    constructor(source) {
      this.source = source;
    }
  };
  f.host.PIXI.Texture = class {
    constructor(baseTexture) {
      this.baseTexture = baseTexture;
    }
  };
  // Use the implementation rather than the async fixture decoder.
  const { MarkerRenderer } =
    await import("../scripts/foundry/marker-renderer.js");
  const renderer = new MarkerRenderer(f.host);
  const a = await renderer.decodeImage(png);
  const b = await renderer.decodeImage(png);
  assert.notEqual(a.baseTexture, b.baseTexture);
  assert.deepEqual(sources, [png, png]);
  assert.equal(
    await renderer.decodeImage("https://example.invalid/hidden.webp"),
    null
  );
  assert.equal(sources.length, 2);
});

test("a failed checkpoint update invalidates old data instead of resurrecting a forgotten ghost", () => {
  const data = storage();
  const a = boot(data);
  const second = token(a.host, "second");
  a.update();
  a.enemy.visible = a.enemy.visual = second.visible = second.visual = false;
  a.update();
  assert.equal(data.values.size, 1);
  data.setItem = () => {
    throw new Error("quota");
  };
  a.tracker.forget("enemy");
  assert.equal(a.store.remembered().length, 1);
  assert.equal(a.tracker.renderer.markers.size, 1);
  assert.equal(data.values.size, 0);
  const b = boot(data);
  b.enemy.visible = b.enemy.visual = false;
  b.update();
  assert.equal(b.store.size, 0);
  assert.equal(a.warnings.length, 1);
  a.tracker.suspend();
  b.tracker.suspend();
});

test("multiple saved Plain ghosts restore independently when PNG decodes complete out of order", async () => {
  const data = storage();
  const a = boot(data);
  const second = token(a.host, "second");
  second.position.x = 300;
  second.mesh.position.x = 350;
  a.update();
  a.enemy.visible = a.enemy.visual = second.visible = second.visual = false;
  a.update();
  const b = boot(data);
  b.enemy.visible = b.enemy.visual = false;
  const pending = [];
  b.tracker.renderer.decodeImage = () =>
    new Promise(resolve => pending.push(resolve));
  b.update();
  assert.equal(b.tracker.renderer.markers.size, 2); // Geometry is available before PNG decoding.
  const firstTexture = b.host.canvas.app.renderer.generateTexture();
  const secondTexture = b.host.canvas.app.renderer.generateTexture();
  pending[1](secondTexture);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(b.tracker.renderer.markers.size, 2);
  pending[0](firstTexture);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(b.tracker.renderer.markers.size, 2);
  assert.deepEqual(
    [...b.tracker.renderer.markers.values()]
      .map(marker => marker.container.position.x)
      .sort((x, y) => x - y),
    [20, 300]
  );
  assert.equal(
    new Set(
      [...b.tracker.renderer.textures.values()].map(entry => entry.texture)
    ).size,
    2
  );
  const forgotten = b.tracker.renderer.textures.get("enemy").texture;
  const retained = b.tracker.renderer.textures.get("second").texture;
  b.tracker.forget("enemy");
  assert.equal(forgotten.destroyed, true);
  assert.equal(retained.destroyed, false);
  assert.equal(b.tracker.renderer.markers.size, 1);
  a.tracker.suspend();
  b.tracker.suspend();
});
