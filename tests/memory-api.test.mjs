import assert from "node:assert/strict";
import test from "node:test";
import { runtimeHost, token } from "./helpers/runtime.mjs";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { registerSettings } from "../scripts/settings.js";
import { CombatMemoryPing } from "../scripts/combat-memory-ping.js";
import { createMemoryAPI } from "../scripts/memory-api.js";

function fixture() {
  const f = runtimeHost();
  const tracker = new ObservationTracker(f.host, new MemoryStore());
  registerSettings(f.host.game.settings, () => tracker.notifyMemory(true));
  const enemy = token(f.host);
  const unknown = token(f.host, "unknown");
  unknown.visible = unknown.visual = false;
  const shared = [],
    pans = [];
  f.host.canvas.ping = (...args) => shared.push(args);
  f.host.canvas.animatePan = async position => pans.push(position);
  const controller = createMemoryAPI(
    f.host,
    tracker,
    new CombatMemoryPing(f.host, tracker)
  );
  const update = () => {
    tracker.schedule();
    f.frame();
  };
  update();
  enemy.visible = enemy.visual = false;
  update();
  return {
    ...f,
    tracker,
    enemy,
    shared,
    pans,
    update,
    controller,
    api: controller.api
  };
}
const event = {
  preventDefault() {},
  stopImmediatePropagation() {},
  shiftKey: true
};

test("public memory API prepares frozen local records and delegates remembered actions without hidden reads", async () => {
  const f = fixture();
  const [record] = f.api.list();
  assert.deepEqual(Object.keys(record).sort(), ["id", "label", "name"]);
  assert.equal(record.name, "Known enemy");
  assert.ok(Object.isFrozen(record));
  Object.defineProperty(f.enemy.document, "x", {
    get() {
      throw new Error("Hidden position read");
    }
  });
  Object.defineProperty(f.enemy.document, "name", {
    get() {
      throw new Error("Hidden name read");
    }
  });
  assert.equal(f.api.ping(record.id, event), true);
  assert.deepEqual(f.shared, [[{ x: 70, y: 80 }]]);
  assert.equal(await f.api.center(record.id), true);
  assert.deepEqual(f.pans, [{ x: 70, y: 80 }]);
  await f.host.game.settings.set("probably-just-a-rat", "showNames", false);
  assert.equal(f.api.list()[0].name, "RAT.Unknown");
  assert.equal(f.api.forget(record.id), true);
  assert.deepEqual(f.api.list(), []);
  assert.equal(f.api.ping(record.id, event), false);
  f.controller.dispose();
  f.tracker.suspend();
});

test("memory handles reject rediscovery, expiry, changed sources and closed providers", async () => {
  const f = fixture();
  const old = f.api.list()[0].id;
  f.enemy.visible = f.enemy.visual = true;
  f.update();
  assert.equal(f.api.forget(old), false);
  f.enemy.visible = f.enemy.visual = false;
  f.update();
  const next = f.api.list()[0].id;
  assert.notEqual(next, old);
  f.source.visionMode = { id: "different" };
  assert.equal(await f.api.center(next), false);
  assert.equal(f.api.ping(next, event), false);
  f.update();
  assert.deepEqual(f.api.list(), []);
  let changes = 0;
  const off = f.api.subscribe(() => changes++);
  f.api.subscribe(() => {
    throw new Error("consumer failure");
  });
  f.tracker.notifyMemory(true);
  assert.equal(changes, 1);
  assert.equal(f.tracker.failed, false);
  off();
  f.controller.dispose();
  assert.equal(changes, 1);
  assert.equal(f.tracker.memoryListeners.size, 0);
  assert.deepEqual(f.api.list(), []);
  f.tracker.suspend();
});

test("expired handles cannot ping or move the camera before the next TTL render", async () => {
  const f = fixture();
  const id = f.api.list()[0].id;
  f.tracker.store.setPolicy({ seconds: 0.000001 });
  assert.equal(f.api.ping(id, event), false);
  assert.equal(await f.api.center(id), false);
  assert.equal(f.api.forget(id), false);
  assert.deepEqual(f.shared, []);
  assert.deepEqual(f.pans, []);
  f.controller.dispose();
  f.tracker.suspend();
});
