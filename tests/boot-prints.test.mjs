import assert from "node:assert/strict";
import test from "node:test";
import { installModule } from "../scripts/lifecycle.js";
import { MODULE_ID } from "../scripts/constants.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";
import { MarkerRenderer } from "../scripts/foundry/marker-renderer.js";
import { registerSettings } from "../scripts/settings.js";

test("players follow the GM's world marker choice even when a local preview requests another style", () => {
  const f = runtimeHost();
  registerSettings(f.host.game.settings, () => {});
  const renderer = new MarkerRenderer(f.host);
  f.settings.get("markerStyle").value = "footprints";
  renderer.setPreview({ markerStyle: "ghost", opacity: 65 });
  assert.equal(renderer.appearance().markerStyle, "footprints");
  assert.equal(renderer.appearance().opacity, 0.65);
  f.host.game.user.isGM = true;
  assert.equal(renderer.appearance().markerStyle, "ghost");
  f.host.game.user.isGM = false;
  assert.equal(renderer.appearance().markerStyle, "footprints");
  renderer.clear();
});

test("boot prints reuse frozen memory and switching back restores its image without hidden reads", async () => {
  const f = runtimeHost();
  const controller = installModule(f.host);
  const enemy = token(f.host);
  f.emit("init");
  f.emit("ready");
  f.frame();
  // The displayed token moves east while its document already has another destination.
  enemy.document.x = 999;
  enemy.position.x = 70;
  enemy.mesh.position.x = 120;
  enemy.mesh.angle = 37;
  f.emit("refreshToken", enemy);
  f.frame();
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  const ghost = root.children[0];
  const frozenImage = ghost.children.find(
    child => child.name === "rat-ghost-image"
  ).texture;
  const position = { ...ghost.position };
  Object.defineProperty(enemy, "texture", {
    get() {
      throw new Error("Hidden texture read");
    }
  });
  Object.defineProperty(enemy.document, "x", {
    get() {
      throw new Error("Hidden position read");
    }
  });
  Object.defineProperty(enemy.mesh, "angle", {
    get() {
      throw new Error("Hidden rotation read");
    }
  });
  await f.host.game.settings.set(MODULE_ID, "markerStyle", "footprints");
  await f.host.game.settings.set(MODULE_ID, "customMarkerRotate", true);
  f.frame();
  const marker = root.children[0];
  const prints = marker.children.find(
    child => child.name === "rat-boot-prints"
  );
  assert.ok(prints);
  assert.equal(prints.children.length, 2);
  assert.equal(prints.alpha, 0.5);
  assert.equal(prints.angle, 90);
  await f.host.game.settings.set(MODULE_ID, "customMarkerRotate", false);
  f.frame();
  assert.equal(root.children[0].children[0].angle, 0);
  assert.equal(prints.destroyed, true);
  assert.deepEqual({ ...marker.position }, position);
  assert.equal(marker.eventMode, "none");
  assert.equal(marker.interactiveChildren, false);
  assert.equal(prints.eventMode, "none");
  assert.equal(frozenImage.destroyed, false);
  assert.equal(
    f.host.game.modules.get(MODULE_ID).api.getDiagnostics().failed,
    false
  );
  await f.host.game.settings.set(MODULE_ID, "markerStyle", "ghost");
  f.frame();
  assert.equal(prints.destroyed, true);
  assert.equal(
    root.children[0].children.find(child => child.name === "rat-ghost-image")
      .texture,
    frozenImage
  );
  controller.dispose();
  assert.equal(frozenImage.destroyed, true);
});

test("boot-print mode works without a captured image and removes the marker on rediscovery", async () => {
  const f = runtimeHost();
  const controller = installModule(f.host);
  const enemy = token(f.host);
  enemy.texture.baseTexture.resource.source.tagName = "VIDEO";
  f.emit("init");
  await f.host.game.settings.set(MODULE_ID, "markerStyle", "footprints");
  f.emit("ready");
  f.frame();
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  assert.equal(root.children[0].children[0].name, "rat-boot-prints");
  enemy.visual = enemy.visible = true;
  f.emit("refreshToken", enemy);
  f.frame();
  assert.equal(root.children.length, 0);
  controller.dispose();
});

test("neutral presence trace needs no image, follows saved dimensions and is removed on rediscovery", async () => {
  const f = runtimeHost();
  const controller = installModule(f.host);
  const enemy = token(f.host);
  enemy.texture.baseTexture.resource.source.tagName = "VIDEO";
  f.emit("init");
  await f.host.game.settings.set(MODULE_ID, "markerStyle", "presence");
  f.emit("ready");
  f.frame();
  enemy.visual = enemy.visible = false;
  f.emit("refreshToken", enemy);
  f.frame();
  const root = f.host.canvas.interface.children.find(
    child => child.name === "probably-just-a-rat-memory"
  );
  const trace = root.children[0].children[0];
  assert.equal(trace.name, "rat-presence-trace");
  assert.equal(trace.position.x, 50);
  assert.equal(trace.position.y, 50);
  assert.equal(trace.alpha, 0.5);
  assert.equal(trace.eventMode, "none");
  assert.equal(trace.interactiveChildren, false);
  assert.equal(
    root.children[0].children.some(child => child.name === "rat-ghost-image"),
    false
  );
  enemy.visual = enemy.visible = true;
  f.emit("refreshToken", enemy);
  f.frame();
  assert.equal(trace.destroyed, true);
  assert.equal(root.children.length, 0);
  controller.dispose();
});
