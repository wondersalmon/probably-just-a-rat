import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "../scripts/core/memory-store.js";

const context = {
  sceneId: "scene",
  userId: "player",
  levelId: "floor",
  sourceIds: ["hero"],
  mode: "limited",
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
  texture: "goblin.webp",
  name: "Unknown creature"
};
function fixture(policy = {}) {
  let time = 0;
  const store = new MemoryStore({ now: () => time, policy });
  store.setContext(context);
  return {
    store,
    advance: ms => {
      time += ms;
    }
  };
}

test("footprint headings follow visible movement in every direction, independently of artwork rotation", () => {
  for (const [dx, dy, expected] of [
    [0, -20, 0],
    [20, -20, 45],
    [20, 0, 90],
    [20, 20, 135],
    [0, 20, 180],
    [-20, 20, 225],
    [-20, 0, 270],
    [-20, -20, 315]
  ]) {
    const { store } = fixture();
    store.observe("enemy", visual);
    assert.equal(store.get("enemy").snapshot.movementAngle, 0);
    const moved = { ...visual, x: visual.x + dx, y: visual.y + dy };
    store.observe("enemy", moved);
    assert.equal(store.get("enemy").snapshot.movementAngle, expected);
    store.observe("enemy", { ...moved, rotation: 123, width: 200 });
    assert.equal(store.get("enemy").snapshot.movementAngle, expected);
    store.observe("enemy", { ...moved, x: moved.x + 0.001 });
    assert.equal(store.get("enemy").snapshot.movementAngle, expected);
    const frozen = store.get("enemy").snapshot;
    store.loseSight("enemy");
    store.loseSight("enemy");
    assert.equal(store.get("enemy").snapshot, frozen);
  }
});

test("rediscovery and context changes do not infer a movement direction across unseen positions", () => {
  const { store } = fixture();
  store.observe("enemy", visual);
  store.observe("enemy", { ...visual, x: 100 });
  assert.equal(store.get("enemy").snapshot.movementAngle, 90);
  store.loseSight("enemy");
  store.observe("enemy", { ...visual, x: 500, y: 500 });
  assert.equal(store.get("enemy").snapshot.movementAngle, 0);
  store.observe("enemy", { ...visual, x: 480, y: 500 });
  assert.equal(store.get("enemy").snapshot.movementAngle, 270);
  store.setContext({ ...context, sceneId: "next-scene" });
  store.observe("enemy", visual);
  assert.equal(store.get("enemy").snapshot.movementAngle, 0);
});

test("elapsed round age begins at loss, survives persistence and never follows a round rewind backwards", () => {
  const { store } = fixture({ combatRounds: 0 });
  store.setCombat({ id: "fight", round: 1, turn: 0 });
  store.observe("enemy", visual);
  store.setCombat({ id: "fight", round: 5, turn: 0 });
  store.loseSight("enemy");
  assert.equal(store.roundsSinceLoss(store.get("enemy")), 0);
  store.setCombat({ id: "fight", round: 8, turn: 0 });
  assert.equal(store.roundsSinceLoss(store.get("enemy")), 3);
  store.setCombat({ id: "fight", round: 6, turn: 0 });
  assert.equal(store.roundsSinceLoss(store.get("enemy")), 3);
  const { store: restored } = fixture({ combatRounds: 0 });
  restored.setCombat({ id: "fight", round: 6, turn: 0 });
  restored.restore(store.checkpoint(), 0);
  assert.equal(restored.roundsSinceLoss(restored.get("enemy")), 3);
  restored.setCombat({ id: "fight", round: 9, turn: 0 });
  assert.equal(restored.roundsSinceLoss(restored.get("enemy")), 4);
});

test("unknown tokens and absent or wrong-level contexts never create memory", () => {
  const store = new MemoryStore();
  store.loseSight("unseen");
  assert.equal(store.observe("enemy", visual), false);
  store.setContext(context);
  assert.equal(store.observe("enemy", { ...visual, levelId: "other" }), false);
  assert.equal(store.size, 0);
});

test("observation, loss and rediscovery use independent immutable snapshots", () => {
  const { store } = fixture();
  const input = { ...visual, hp: 10, actor: { secret: true } };
  store.observe("enemy", input);
  input.x = 999;
  const snapshot = store.get("enemy").snapshot;
  assert.equal(snapshot.x, 20);
  assert.equal("hp" in snapshot, false);
  assert.equal("actor" in snapshot, false);
  store.loseSight("enemy");
  for (let i = 0; i < 5; i++) store.loseSight("enemy");
  assert.equal(store.remembered()[0].snapshot, snapshot);
  assert.throws(() => {
    snapshot.x = 1000;
  }, TypeError);
  store.observe("enemy", { ...visual, x: 70 });
  assert.equal(store.remembered().length, 0);
  assert.equal(store.get("enemy").snapshot.x, 70);
});

test("two tokens of the same actor and two clients remain independent", () => {
  const a = fixture().store;
  const b = fixture().store;
  a.observe("one", visual);
  a.observe("two", { ...visual, x: 80 });
  b.observe("one", { ...visual, x: 50 });
  a.loseSight("one");
  b.loseSight("one");
  assert.equal(a.get("two").snapshot.x, 80);
  assert.equal(a.remembered()[0].snapshot.x, 20);
  assert.equal(b.remembered()[0].snapshot.x, 50);
  a.clear();
  assert.equal(b.size, 1);
});

test("source order is stable; scene, user, level, sources, modes and permissions reset memory", () => {
  for (const change of [
    { sceneId: "next" },
    { userId: "next" },
    { levelId: "next" },
    { sourceIds: ["next"] },
    { mode: "next" },
    { permissionKey: "next" }
  ]) {
    const { store } = fixture();
    store.observe("enemy", visual);
    store.setContext({ ...context, ...change });
    assert.equal(store.size, 0);
  }
  const { store } = fixture();
  store.setContext({ ...context, sourceIds: ["a", "b"] });
  store.observe("enemy", visual);
  store.setContext({ ...context, sourceIds: ["b", "a", "a"] });
  assert.equal(store.size, 1);
  store.setContext(null);
  assert.equal(store.size, 0);
  assert.equal(store.observe("enemy", visual), false);
});

test("real-time TTL expires at its boundary and expired memory cannot be revived by loss", () => {
  const { store, advance } = fixture({ seconds: 1 });
  store.observe("enemy", visual);
  store.loseSight("enemy");
  advance(999);
  assert.equal(store.remembered().length, 1);
  advance(1);
  assert.equal(store.get("enemy"), undefined);
  store.loseSight("enemy");
  assert.equal(store.size, 0);
  store.observe("enemy", visual);
  assert.equal(store.size, 1);
});

test("zero TTL disables automatic expiry", () => {
  const { store, advance } = fixture({ seconds: 0, combatRounds: 0 });
  store.observe("enemy", visual);
  store.loseSight("enemy");
  advance(1e9);
  assert.equal(store.remembered().length, 1);
  store.setCombat({ id: "fight", round: 1, turn: 0 });
  store.observe("enemy", visual);
  store.loseSight("enemy");
  store.setCombat({ id: "fight", round: 1000, turn: 0 });
  assert.equal(store.remembered().length, 1);
});

test("combat start and replacement discard previous histories", () => {
  const { store } = fixture();
  store.observe("enemy", visual);
  store.setCombat({ id: "first", round: 1, turn: 0 });
  assert.equal(store.size, 0);
  store.observe("enemy", visual);
  store.setCombat({ id: "second", round: 1, turn: 0 });
  assert.equal(store.size, 0);
});

test("combat expiry uses rounds, ignores elapsed real time and cannot reverse", () => {
  const { store, advance } = fixture();
  store.setCombat({ id: "fight", round: 3, turn: 0 });
  store.observe("enemy", visual);
  store.loseSight("enemy");
  advance(1e9);
  store.setCombat({ id: "fight", round: 4, turn: 1 });
  assert.equal(store.remembered().length, 1);
  store.setCombat({ id: "fight", round: 1, turn: 0 });
  assert.equal(store.get("enemy").snapshot.combat.round, 3);
  store.setCombat({ id: "fight", round: 5, turn: 0 });
  assert.equal(store.size, 0);
  store.setCombat({ id: "fight", round: 2, turn: 0 });
  assert.equal(store.size, 0);
});

test("observations after a rewind use the high-water mark", () => {
  const { store } = fixture();
  store.setCombat({ id: "fight", round: 5, turn: 0 });
  store.setCombat({ id: "fight", round: 1, turn: 0 });
  store.observe("enemy", visual);
  assert.equal(store.get("enemy").snapshot.combat.round, 1);
  store.loseSight("enemy");
  store.setCombat({ id: "fight", round: 6, turn: 0 });
  assert.equal(store.remembered().length, 1);
  store.setCombat({ id: "fight", round: 7, turn: 0 });
  assert.equal(store.size, 0);
});

test("combat end clears by default, or starts a fresh real-time TTL", () => {
  for (const clearOnCombatEnd of [true, false]) {
    const { store, advance } = fixture({ clearOnCombatEnd, seconds: 1 });
    store.setCombat({ id: "fight", round: 1, turn: 0 });
    store.observe("enemy", visual);
    store.loseSight("enemy");
    advance(5000);
    store.setCombat(null);
    assert.equal(store.size, clearOnCombatEnd ? 0 : 1);
    if (!clearOnCombatEnd) {
      assert.equal(store.get("enemy").snapshot.observedAt, 0);
      advance(999);
      assert.equal(store.remembered().length, 1);
      advance(1);
      assert.equal(store.remembered().length, 0);
    }
  }
});

test("visible deletion removes memory; unseen deletion retains the frozen record", () => {
  const { store } = fixture();
  store.observe("visible", visual);
  store.observe("unseen", visual);
  store.loseSight("unseen");
  store.deleteToken("visible");
  store.deleteToken("unseen");
  assert.equal(store.get("visible"), undefined);
  assert.equal(store.remembered().length, 1);
  store.forget("unseen");
  assert.equal(store.size, 0);
});

test("invalid inputs fail without replacing a valid snapshot", () => {
  const { store } = fixture();
  store.observe("enemy", visual);
  assert.throws(() => store.observe("enemy", { ...visual, x: NaN }), TypeError);
  assert.throws(() => store.setPolicy({ seconds: -1 }), TypeError);
  assert.throws(
    () => store.setCombat({ id: "fight", round: -1, turn: 0 }),
    TypeError
  );
  assert.throws(
    () => store.setContext({ ...context, sourceIds: [] }),
    TypeError
  );
  assert.equal(store.get("enemy").snapshot.x, 20);
});

test("policy changes expire existing records without restoring old ones", () => {
  const { store, advance } = fixture();
  store.observe("enemy", visual);
  store.loseSight("enemy");
  advance(2000);
  store.setPolicy({ seconds: 1 });
  assert.equal(store.size, 0);
  store.setPolicy({ seconds: 300 });
  assert.equal(store.size, 0);
});
