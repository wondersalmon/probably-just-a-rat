import assert from "node:assert/strict";
import test from "node:test";
import { Sprite, Texture, Point } from "pixi.js";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { MarkerRenderer } from "../scripts/foundry/marker-renderer.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";

function fixture() {
  const f = runtimeHost();
  registerSettings(f.host.game.settings, () => {});
  f.settings.get("grayscale").value = 0;
  const enemy = token(f.host);
  const tracker = new ObservationTracker(f.host, new MemoryStore());
  return { ...f, enemy, tracker };
}

test("dynamic-ring ghost matches native subject size, noncentral anchor, mirroring and rotation", () => {
  const f = fixture();
  const mesh = f.enemy.mesh;
  f.enemy.hasDynamicRing = true;
  f.enemy.ring = { textureScaleAdjustment: 1.25 };
  mesh.width = 125;
  mesh.height = 75;
  mesh.anchor = { x: 0.3, y: 0.7 };
  mesh.scale.x = -1;
  mesh.angle = 27;
  f.tracker.schedule();
  f.frame();
  const snapshot = f.tracker.store.get("enemy").snapshot;
  assert.equal(snapshot.imageWidth, 100);
  assert.equal(snapshot.imageHeight, 60);
  const texture = Texture.fromBuffer(new Uint8Array(200 * 120 * 4), 200, 120);
  const renderer = new MarkerRenderer({
    ...f.host,
    PIXI: { ...f.host.PIXI, Sprite }
  });
  const image = renderer.imageSprite(texture, snapshot);
  const angle = (mesh.angle * Math.PI) / 180;
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ]) {
    const nativeX = ((u - 0.5) / 1.25 + 0.5 - mesh.anchor.x) * mesh.width * -1;
    const nativeY = ((v - 0.5) / 1.25 + 0.5 - mesh.anchor.y) * mesh.height;
    const expected = {
      x: 50 + nativeX * Math.cos(angle) - nativeY * Math.sin(angle),
      y: 50 + nativeX * Math.sin(angle) + nativeY * Math.cos(angle)
    };
    const actual = image.toGlobal(
      new Point((u - image.anchor.x) * 200, (v - image.anchor.y) * 120)
    );
    assert.ok(
      Math.abs(actual.x - expected.x) < 1e-7,
      `x mismatch for ${u},${v}`
    );
    assert.ok(
      Math.abs(actual.y - expected.y) < 1e-7,
      `y mismatch for ${u},${v}`
    );
  }
  image.destroy({ texture: false, baseTexture: false });
  texture.destroy(true);
  f.tracker.suspend();
});

test("distinct rendered subject is copied once and hidden ring/image changes cannot resize it", () => {
  const f = fixture();
  f.enemy.hasDynamicRing = true;
  f.enemy.ring = { textureScaleAdjustment: 1 };
  const subject = {
    ...f.enemy.texture,
    baseTexture: { resource: { source: { src: "observed-subject.webp" } } }
  };
  f.enemy.mesh.texture = subject;
  f.enemy.mesh.width = 72;
  f.enemy.mesh.height = 96;
  f.tracker.schedule();
  f.frame();
  const record = f.tracker.store.get("enemy");
  assert.equal(record.snapshot.texture, "observed-subject.webp");
  assert.equal(f.tracker.renderer.textures.get("enemy").original, subject);
  f.enemy.visual = f.enemy.visible = false;
  for (const [object, key] of [
    [f.enemy, "ring"],
    [f.enemy.mesh, "texture"],
    [f.enemy.mesh, "width"]
  ])
    Object.defineProperty(object, key, {
      get() {
        throw new Error("Hidden appearance read");
      }
    });
  f.tracker.schedule(f.enemy);
  f.frame();
  assert.equal(f.tracker.failed, false);
  assert.equal(f.tracker.store.get("enemy").snapshot, record.snapshot);
  assert.equal(f.tracker.renderer.markers.get("enemy").snapshot.imageWidth, 72);
  f.tracker.suspend();
  assert.equal(subject.destroyed, false);
});

test("ordinary tokens ignore stale ring state and preserve their actual texture scale", () => {
  const f = fixture();
  f.enemy.hasDynamicRing = false;
  Object.defineProperty(f.enemy, "ring", {
    get() {
      throw new Error("No ring should be inspected");
    }
  });
  f.enemy.mesh.width = 140;
  f.enemy.mesh.height = 80;
  f.tracker.schedule();
  f.frame();
  const snapshot = f.tracker.store.get("enemy").snapshot;
  assert.equal(snapshot.imageWidth, 140);
  assert.equal(snapshot.imageHeight, 80);
  assert.equal(snapshot.anchorX, 0.5);
  f.tracker.suspend();
});
