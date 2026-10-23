import assert from "node:assert/strict";
import test from "node:test";
import { MarkerRenderer } from "../scripts/foundry/marker-renderer.js";
import { resolveAppearance } from "../scripts/appearance.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost } from "./helpers/runtime.mjs";

test("movement rotation uses the frozen heading and remains disabled by default", () => {
  const f = runtimeHost();
  const renderer = new MarkerRenderer(f.host);
  const frozen = Object.freeze({
    width: 100,
    height: 100,
    rotation: 123,
    scaleX: -1,
    scaleY: 1,
    movementAngle: 90
  });
  const texture = { width: 200, height: 100 };
  assert.equal(
    resolveAppearance({ opacity: 50, labels: "normal" }).customMarkerRotate,
    false
  );
  assert.equal(renderer.customImageSnapshot(texture, frozen).rotation, 0);
  const turned = renderer.customImageSnapshot(texture, frozen, true);
  assert.equal(turned.rotation, 90);
  assert.equal(turned.scaleX, 1);
  assert.equal(turned.imageWidth, 80);
  assert.equal(turned.imageHeight, 40);
  assert.equal(
    renderer.customImageSnapshot(
      texture,
      { ...frozen, movementAngle: undefined },
      true
    ).rotation,
    0
  );
});

test("caption preview updates and shared rotation world rules remain GM-controlled", () => {
  const f = runtimeHost();
  registerSettings(f.host.game.settings, () => {});
  assert.equal(f.settings.get("customMarkerRotate").scope, "world");
  assert.equal(f.settings.get("customMarkerRotate").default, false);
  const renderer = new MarkerRenderer(f.host, { roundsSinceLoss: () => 3 });
  const record = { snapshot: { name: "Enemy", width: 100 } };
  f.settings.get("showNames").value = false;
  f.settings.get("showRounds").value = false;
  f.settings.get("customMarkerRotate").value = false;
  assert.equal(
    renderer.setPreview({
      labels: "contrast",
      showNames: true,
      showRounds: true,
      customMarkerRotate: true
    }),
    true
  );
  assert.equal(renderer.appearance().customMarkerRotate, false);
  assert.doesNotMatch(renderer.caption(record), /Enemy/);
  f.host.game.user.isGM = true;
  assert.equal(renderer.appearance().customMarkerRotate, true);
  assert.match(renderer.caption(record), /Enemy/);
  assert.notEqual(
    renderer.label(record),
    f.host.game.i18n.localize("RAT.LastPosition")
  );
  assert.equal(renderer.setPreview({ captionStyle: "off" }), true);
  assert.equal(renderer.appearance().labels, false);
  assert.equal(renderer.setPreview({ captionStyle: "off" }), false);
});

for (const [style, artwork] of [
  ["ghost", true],
  ["footprints", false],
  ["presence", false],
  ["custom", true],
  ["custom", false],
  ["ghost", false]
]) {
  test(`${style} marker (${artwork ? "image" : "procedural or fallback"}) follows the shared rotation toggle without changing its snapshot or caption`, () => {
    const f = runtimeHost();
    registerSettings(f.host.game.settings, () => {});
    const renderer = new MarkerRenderer(f.host);
    renderer.mount();
    f.settings.get("markerStyle").value = style;
    f.settings.get("outline").value = true;
    const snapshot = Object.freeze({
      x: 20,
      y: 30,
      width: 100,
      height: 80,
      imageWidth: 90,
      imageHeight: 70,
      anchorX: 0.3,
      anchorY: 0.7,
      rotation: 123,
      scaleX: -1,
      scaleY: 1,
      movementAngle: 90,
      name: "Enemy"
    });
    const record = { tokenId: "enemy", snapshot };
    const texture = { width: 200, height: 100 };
    if (artwork) {
      if (style === "custom") renderer.customImage.texture = texture;
      else renderer.textures.set("enemy", { texture });
    }
    for (const enabled of [false, true, false]) {
      f.settings.get("customMarkerRotate").value = enabled;
      renderer.removeMarker("enemy");
      renderer.create(record);
      const marker = renderer.markers.get("enemy");
      const art = marker.container.children.filter(
        child => child !== marker.caption
      );
      const expected = enabled ? 90 : style === "ghost" && artwork ? 123 : 0;
      for (const child of art) {
        assert.equal(child.angle, expected);
        assert.equal(child.position.x, snapshot.width / 2);
        assert.equal(child.position.y, snapshot.height / 2);
      }
      assert.equal(marker.snapshot, snapshot);
      assert.deepEqual(
        { ...marker.container.position },
        { x: snapshot.x, y: snapshot.y }
      );
      assert.equal(marker.container.angle ?? 0, 0);
      assert.equal(marker.caption.angle ?? 0, 0);
      assert.equal(marker.caption.position.y, snapshot.height + 6);
    }
  });
}
