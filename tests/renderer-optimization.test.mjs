import assert from "node:assert/strict";
import test from "node:test";
import { Rectangle, Matrix, Transform } from "pixi.js";
import { MarkerRenderer } from "../scripts/foundry/marker-renderer.js";
import { bakeFrozenArt } from "../scripts/foundry/static-art.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { registerSettings, migrateCaptions } from "../scripts/settings.js";
import { resolveAppearance } from "../scripts/appearance.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";
import { installModule } from "../scripts/lifecycle.js";

function enableBaking(f) {
  f.host.PIXI.Rectangle = Rectangle;
  f.host.PIXI.Matrix = Matrix;
  f.host.PIXI.Transform = Transform;
  f.bakedAllocations = [];
  f.host.PIXI.RenderTexture = {
    create: options => {
      const texture = f.host.canvas.app.renderer.generateTexture(null, options);
      texture.resolution = options.resolution;
      f.bakedAllocations.push(texture);
      return texture;
    }
  };
  f.host.canvas.app.renderer.render = () => {};
  f.host.PIXI.Container.prototype.getLocalBounds = () =>
    new Rectangle(-120, -200, 1600, 900);
  f.host.PIXI.Container.prototype.removeChildren = function () {
    const children = this.children;
    this.children = [];
    for (const child of children) child.parent = null;
    return children;
  };
}

test("unchanged bounds and TTL-style sync do not rebuild the mask; removal, resize and teardown invalidate it", () => {
  const f = runtimeHost();
  const renderer = new MarkerRenderer(f.host);
  const enemy = token(f.host);
  renderer.trackVisibility(enemy, true);
  renderer.sync([]);
  const mask = renderer.mask;
  let clears = 0;
  const clear = mask.clear.bind(mask);
  mask.clear = () => {
    clears++;
    return clear();
  };
  renderer.sync([]);
  renderer.trackVisibility(enemy, true);
  renderer.sync([]);
  assert.equal(clears, 0);
  enemy.position.x += 10;
  renderer.trackVisibility(enemy, true);
  renderer.sync([]);
  assert.equal(clears, 1);
  renderer.forgetVisibility(enemy.document.id);
  renderer.sync([]);
  renderer.forgetVisibility(enemy.document.id);
  renderer.sync([]);
  assert.equal(clears, 2);
  f.host.canvas.dimensions.rect.width += 50;
  renderer.sync([]);
  assert.equal(clears, 3);
  renderer.clear();
  assert.equal(renderer.maskDirty, true);
  assert.equal(renderer.maskRect, null);
  assert.equal(mask.destroyed, true);
  renderer.sync([]);
  assert.notEqual(renderer.mask, mask);
  assert.equal(renderer.maskDirty, false);
  renderer.clear();
});

test("baked artwork has a bounded independent texture and releases filters without destroying the frozen source", () => {
  const f = runtimeHost();
  enableBaking(f);
  const art = new f.host.PIXI.Container();
  const native = token(f.host).texture;
  const image = art.addChild(new f.host.PIXI.Sprite(native));
  const filter = new f.host.PIXI.BlurFilter();
  filter.padding = 20;
  const filters = [filter];
  const generate = f.host.canvas.app.renderer.generateTexture;
  let options;
  f.host.canvas.app.renderer.generateTexture = (_container, value) => {
    options = value;
    return generate();
  };
  const texture = bakeFrozenArt(f.host, art, filters);
  assert.ok(texture);
  assert.ok(options.width * options.resolution <= 512);
  assert.ok(options.height * options.resolution <= 512);
  assert.equal(art.children.length, 1);
  assert.equal(art.children[0].name, "rat-ghost-baked");
  assert.equal(art.children[0].texture, texture);
  assert.equal(art.children[0].position.x, -140);
  assert.equal(art.children[0].position.y, -220);
  assert.equal(image.destroyed, true);
  assert.equal(native.destroyed, false);
  assert.equal(filter.destroyed, true);
  assert.equal(filters.length, 0);
});

test("baking failure restores PIXI transform and retains original artwork and filters", () => {
  const f = runtimeHost();
  enableBaking(f);
  const art = new f.host.PIXI.Container();
  const transform = (art.transform = {});
  const image = art.addChild(new f.host.PIXI.Sprite(token(f.host).texture));
  const filter = new f.host.PIXI.BlurFilter();
  filter.resolution = 1;
  f.host.canvas.app.renderer.render = (_art, options) => {
    assert.ok(filter.resolution <= options.renderTexture.resolution);
    art.transform = {};
    throw new Error("GPU unavailable");
  };
  assert.equal(bakeFrozenArt(f.host, art, [filter]), null);
  assert.equal(art.transform, transform);
  assert.equal(art.children[0], image);
  assert.equal(image.destroyed, false);
  assert.equal(filter.destroyed, false);
  assert.equal(filter.resolution, 1);
  assert.equal(f.bakedAllocations.length, 1);
  assert.equal(f.bakedAllocations[0].destroyed, true);
});

test("failed observed-image capture releases its allocation and never destroys the native texture", () => {
  const f = runtimeHost();
  enableBaking(f);
  const renderer = new MarkerRenderer(f.host);
  const enemy = token(f.host);
  f.host.canvas.app.renderer.render = () => {
    throw new Error("GPU unavailable");
  };
  renderer.capture("enemy", enemy, { texture: "observed.webp" });
  assert.equal(f.bakedAllocations.length, 1);
  assert.equal(f.bakedAllocations[0].destroyed, true);
  assert.equal(enemy.texture.destroyed, false);
  assert.equal(renderer.textures.get("enemy").texture, null);
  renderer.clear();
});

test("caption and name-rule changes reuse the baked image; grayscale changes release it", async () => {
  const f = runtimeHost();
  enableBaking(f);
  const controller = installModule(f.host);
  const enemy = token(f.host);
  f.emit("init");
  f.emit("ready");
  await Promise.resolve();
  await Promise.resolve();
  f.frame();
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  const marker = root.children[0];
  const image = marker.children.find(child => child.name === "rat-ghost-baked");
  const texture = image.texture;
  const allocations = f.bakedAllocations.length;
  for (const [key, value] of [
    ["labels", "contrast"],
    ["labels", "off"],
    ["showNames", false],
    ["showRounds", false],
    ["labels", "standard"]
  ]) {
    await f.host.game.settings.set("probably-just-a-rat", key, value);
    f.frame();
    assert.equal(f.bakedAllocations.length, allocations);
    assert.equal(image.texture, texture);
    assert.equal(texture.destroyed, false);
    assert.equal(root.children[0], marker);
  }
  await f.host.game.settings.set("probably-just-a-rat", "grayscale", 75);
  f.frame();
  assert.equal(texture.destroyed, true);
  controller.dispose();
});

test("rediscovery releases a baked grayscale texture while preserving the observed image and native texture", () => {
  const f = runtimeHost();
  enableBaking(f);
  registerSettings(f.host.game.settings, () => {});
  const tracker = new ObservationTracker(f.host, new MemoryStore());
  const enemy = token(f.host);
  tracker.schedule();
  f.frame();
  const frozen = tracker.renderer.textures.get("enemy").texture;
  enemy.visible = enemy.visual = false;
  tracker.schedule(enemy);
  f.frame();
  const marker = tracker.renderer.markers.get("enemy");
  assert.ok(marker.bakedTexture);
  assert.notEqual(marker.bakedTexture, frozen);
  assert.equal(marker.filters.length, 0);
  assert.equal(
    marker.container.children.filter(child => child.name === "rat-ghost-baked")
      .length,
    1
  );
  enemy.visible = enemy.visual = true;
  tracker.schedule(enemy);
  f.frame();
  assert.equal(marker.bakedTexture.destroyed, true);
  assert.equal(frozen.destroyed, false);
  assert.equal(enemy.texture.destroyed, false);
  tracker.suspend();
});

test("legacy client caption choices inherit the GM policy and retain an explicit contrast preference", async () => {
  const f = runtimeHost();
  registerSettings(f.host.game.settings, () => {});
  assert.equal(f.settings.size, 17);
  for (const [legacy, expected] of [
    [true, "world"],
    ["true", "world"],
    [false, "world"],
    ["false", "world"],
    ["contrast", "contrast"]
  ]) {
    f.settings.get("labels").value = legacy;
    await migrateCaptions(f.host.game.settings);
    assert.equal(f.settings.get("labels").value, expected);
    const appearance = resolveAppearance({
      opacity: 50,
      grayscale: 0,
      labels: expected
    });
    assert.equal(appearance.labels, true);
    assert.equal(appearance.highContrast, expected === "contrast");
  }
  f.settings.get("labels").value = "contrast";
  const tracker = new ObservationTracker(f.host, new MemoryStore());
  const enemy = token(f.host);
  tracker.schedule();
  f.frame();
  enemy.visible = enemy.visual = false;
  tracker.schedule(enemy);
  f.frame();
  const text = tracker.renderer.markers.get("enemy").caption.children[1];
  assert.equal(text.style.fill, 0xffffff);
  assert.equal(text.style.fontSize, 12);
  assert.equal(text.style.stroke, 0);
  tracker.suspend();
});
