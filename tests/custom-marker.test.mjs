import assert from "node:assert/strict";
import test from "node:test";
import { CustomMarkerImage } from "../scripts/foundry/custom-marker-image.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";

const settle = () => new Promise(resolve => setImmediate(resolve));
const source = () => ({
  valid: true,
  width: 640,
  height: 320,
  destroyed: false,
  destroy() {
    this.destroyed = true;
  }
});

test("GM image setting uses the native image-only file field and world scope", () => {
  const f = runtimeHost();
  class FilePathField {
    constructor(options) {
      this.options = options;
    }
    toInput() {}
  }
  registerSettings(f.host.game.settings, () => {}, undefined, FilePathField);
  const setting = f.settings.get("customMarkerImage");
  assert.equal(setting.scope, "world");
  assert.equal(setting.default, "");
  assert.deepEqual(setting.type.options.categories, ["IMAGE"]);
  assert.equal(setting.type.options.blank, true);
  assert.ok(f.settings.get("markerStyle").choices.custom);
});

test("custom artwork owns a bounded copy and releases its silhouette without destroying native assets", async () => {
  const f = runtimeHost();
  const shared = source();
  const loaded = [];
  let changed = 0;
  f.host.foundry.canvas = {
    loadTexture: async path => {
      loaded.push(path);
      return shared;
    }
  };
  const image = new CustomMarkerImage(f.host, () => changed++);
  const regions = [];
  const allocate = f.host.PIXI.RenderTexture.create;
  f.host.PIXI.RenderTexture.create = region => {
    regions.push(region);
    return allocate(region);
  };
  image.use("worlds/map/marker.webp");
  await settle();
  assert.deepEqual(loaded, ["worlds/map/marker.webp"]);
  assert.equal(changed, 1);
  assert.equal(regions[0].width * regions[0].resolution, 256);
  assert.notEqual(image.texture, shared);
  const owned = image.texture;
  image.silhouette = source();
  const silhouette = image.silhouette;
  image.clear();
  assert.equal(owned.destroyed, true);
  assert.equal(silhouette.destroyed, true);
  assert.equal(shared.destroyed, false);
});

test("out-of-order and cancelled custom image loads cannot replace the current image or allocate stale copies", async () => {
  const f = runtimeHost();
  const waiting = new Map();
  let changed = 0;
  f.host.foundry.canvas = {
    loadTexture: path => new Promise(resolve => waiting.set(path, resolve))
  };
  const image = new CustomMarkerImage(f.host, () => changed++);
  image.use("a.webp");
  image.use("b.webp");
  waiting.get("a.webp")(source());
  await settle();
  assert.equal(image.texture, null);
  assert.equal(changed, 0);
  waiting.get("b.webp")(source());
  await settle();
  const owned = image.texture;
  assert.ok(owned);
  assert.equal(changed, 1);
  image.use("c.webp");
  assert.equal(owned.destroyed, true);
  image.clear();
  waiting.get("c.webp")(source());
  await settle();
  assert.equal(image.texture, null);
  assert.equal(changed, 1);
});

test("a failed custom image load settles once and warns only the GM", async () => {
  for (const isGM of [true, false]) {
    const f = runtimeHost();
    f.host.game.user.isGM = isGM;
    let calls = 0;
    let changed = 0;
    f.host.foundry.canvas = {
      loadTexture: async () => {
        calls++;
        throw new Error("Missing file");
      }
    };
    const image = new CustomMarkerImage(f.host, () => changed++);
    image.use("missing.webp");
    await settle();
    image.use("missing.webp");
    assert.equal(calls, 1);
    assert.equal(changed, 1);
    assert.equal(f.warnings.length, isGM ? 1 : 0);
    assert.equal(image.texture, null);
    image.clear();
  }
});

test("players render the GM image with aspect ratio, opacity and grayscale without reading hidden token artwork", async () => {
  const f = runtimeHost();
  const store = new MemoryStore();
  const allocate = f.host.PIXI.RenderTexture.create;
  f.host.PIXI.RenderTexture.create = region =>
    Object.assign(allocate(region), {
      width: region.width,
      height: region.height
    });
  const tracker = new ObservationTracker(f.host, store);
  registerSettings(f.host.game.settings, () => {
    tracker.renderer.rebuild();
    tracker.schedule();
  });
  const loaded = [];
  f.host.foundry.canvas = {
    loadTexture: async path => {
      loaded.push(path);
      return source();
    }
  };
  const enemy = token(f.host);
  f.settings.get("markerStyle").value = "custom";
  f.settings.get("customMarkerImage").value = "worlds/map/marker.webp";
  tracker.schedule();
  f.frame();
  await settle();
  f.frame();
  const snapshot = store.get("enemy").snapshot;
  enemy.visual = enemy.visible = false;
  Object.defineProperty(enemy.document, "texture", {
    get() {
      throw new Error("Hidden image path read");
    }
  });
  Object.defineProperty(enemy.document, "x", {
    get() {
      throw new Error("Hidden destination read");
    }
  });
  tracker.schedule(enemy);
  f.frame();
  tracker.renderer.setPreview({
    markerStyle: "ghost",
    customMarkerImage: "unapproved.webp"
  });
  tracker.renderer.sync(store.records());
  const marker = tracker.renderer.markers.get("enemy");
  const art = marker.container.children.find(
    child => child.name === "rat-ghost-image"
  );
  assert.equal(tracker.renderer.appearance().markerStyle, "custom");
  assert.equal(
    tracker.renderer.appearance().customMarkerImage,
    "worlds/map/marker.webp"
  );
  assert.equal(art.width, 80);
  assert.equal(art.height, 40);
  assert.equal(art.angle, 0);
  assert.equal(art.alpha, 0.5);
  assert.equal(art.filters[0].amount, -0.3);
  assert.equal(marker.snapshot, snapshot);
  assert.deepEqual(loaded, ["worlds/map/marker.webp"]);
  assert.equal(tracker.failed, false);
  tracker.suspend();
});

test("finishing a custom image load after forgetting cannot resurrect its marker", async () => {
  const f = runtimeHost();
  const tracker = new ObservationTracker(f.host, new MemoryStore());
  registerSettings(f.host.game.settings, () => tracker.schedule());
  let finish;
  f.host.foundry.canvas = {
    loadTexture: () =>
      new Promise(resolve => {
        finish = resolve;
      })
  };
  const enemy = token(f.host);
  f.settings.get("markerStyle").value = "custom";
  f.settings.get("customMarkerImage").value = "marker.webp";
  tracker.schedule();
  f.frame();
  enemy.visual = enemy.visible = false;
  tracker.schedule(enemy);
  f.frame();
  assert.equal(tracker.renderer.markers.size, 1);
  tracker.forget("enemy");
  finish(source());
  await settle();
  f.frame();
  assert.equal(tracker.renderer.markers.size, 0);
  assert.equal(tracker.store.size, 0);
  tracker.suspend();
});
