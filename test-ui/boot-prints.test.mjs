import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Serve the real fixture and runtime files without requiring a listening socket.
test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:4179/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = pathname === "/" ? "test-ui/fixture.html" : pathname.slice(1);
    const contentType = file.endsWith(".html")
      ? "text/html"
      : file.endsWith(".json")
        ? "application/json"
        : "text/javascript";
    await route.fulfill({
      body: await readFile(new URL(`../${file}`, import.meta.url)),
      contentType
    });
  });
});

test("coalesced native position refreshes bake footprints at the last seen step with its movement heading", async ({
  page
}) => {
  await page.goto("/?gm");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() =>
    __ratFixture.appearance({
      markerStyle: "footprints",
      customMarkerRotate: true
    })
  );
  await page.evaluate(() => {
    const tracker = __ratFixture.tracker;
    const token = tracker.host.canvas.tokens.placeables.find(
      t => t.document.id === "enemy"
    );
    token.document.x = 1500;
    token.animationContexts = new Map([["movement", {}]]);
    for (const x of [120, 140, 160, 180, 200]) {
      token.position.x = x;
      token.mesh.position.x = x + 50;
      tracker.refreshed(token, { refreshPosition: true });
    }
    token.position.x = 1500;
    token.mesh.position.x = 1550;
    token.visible = token.mesh.visible = false;
    token.animationContexts.clear();
    tracker.refreshed(token, { refreshPosition: true });
  });
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  const result = await page.evaluate(() => {
    const marker = __ratFixture.tracker.renderer.markers.get("enemy");
    return {
      x: marker.container.position.x,
      angle: marker.snapshot.movementAngle,
      width: marker.bakedTexture.width,
      height: marker.bakedTexture.height,
      captionRotation: marker.caption.rotation,
      failed: __ratFixture.tracker.failed
    };
  });
  expect(result.x).toBe(200);
  expect(result.angle).toBe(90);
  expect(result.width).toBeGreaterThan(result.height);
  expect(result.captionRotation).toBe(0);
  expect(result.failed).toBe(false);
});

test("footprints bake the last visible movement angle while their caption stays upright", async ({
  page
}) => {
  await page.goto("/?gm");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(140));
  await page.waitForFunction(
    () => __ratFixture.store.get("enemy")?.snapshot.x === 140
  );
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  await page.evaluate(() =>
    __ratFixture.appearance({
      markerStyle: "footprints",
      customMarkerRotate: true
    })
  );
  await page.waitForFunction(() =>
    __ratFixture.tracker.renderer.markers.has("enemy")
  );
  const result = await page.evaluate(() => {
    const marker = __ratFixture.tracker.renderer.markers.get("enemy");
    return {
      angle: marker.snapshot.movementAngle,
      width: marker.bakedTexture.width,
      height: marker.bakedTexture.height,
      captionRotation: marker.caption.rotation,
      captionText: marker.caption.children[1].text
    };
  });
  expect(result.angle).toBe(90);
  expect(result.width).toBeGreaterThan(result.height);
  expect(result.captionRotation).toBe(0);
  expect(result.captionText).toContain("Last seen position");
  await page.evaluate(() => __ratFixture.move(1000));
  await page.waitForFunction(() => !__ratFixture.tracker.ticker);
  expect(
    await page.evaluate(
      () => __ratFixture.store.get("enemy").snapshot.movementAngle
    )
  ).toBe(90);
});

test("scene mode is GM-only, localized, idempotent and describes effective rules before save", async ({
  page
}) => {
  await page.goto("/?gm&lang=ru");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  const result = await page.evaluate(async () => {
    const { addSceneMemoryOptions } =
      await import("/scripts/foundry/scene-config.js");
    const host = __ratFixture.tracker.host;
    const root = document.createElement("form");
    root.innerHTML = '<div class="tab" data-tab="visibility"></div>';
    const sheet = {
      id: "scene-config-test",
      isEditable: true,
      document: { isOwner: true, getFlag: () => true }
    };
    host.game.user.isGM = false;
    addSceneMemoryOptions(host, sheet, root);
    const playerCount = root.querySelectorAll("select").length;
    host.game.user.isGM = true;
    addSceneMemoryOptions(host, sheet, root);
    addSceneMemoryOptions(host, sheet, root);
    const input = root.querySelector("select");
    const effectiveLong = root.querySelector(
      ".rat-scene-effective-rules"
    ).textContent;
    input.value = "world";
    input.dispatchEvent(new Event("change"));
    const effectiveWorld = root.querySelector(
      ".rat-scene-effective-rules"
    ).textContent;
    input.value = "disabled";
    input.dispatchEvent(new Event("change"));
    const effectiveDisabled = root.querySelector(
      ".rat-scene-effective-rules"
    ).textContent;
    return {
      playerCount,
      count: root.querySelectorAll("select").length,
      options: [...input.options].map(option => option.value),
      effectiveLong,
      effectiveWorld,
      effectiveDisabled,
      name: input.name,
      label: root.querySelector("label").textContent,
      labelFor: root.querySelector("label").htmlFor,
      id: input.id,
      legend: root.querySelector("legend").textContent,
      ratIcon: Boolean(
        root.querySelector('legend .fa-mouse-field[aria-hidden="true"]')
      ),
      firstBlock: root.querySelector(".tab").firstElementChild.tagName,
      hint: root.querySelector(".hint").textContent
    };
  });
  expect(result.legend).toContain("Probably Just a Rat");
  expect(result.legend).toContain("Карта путешествий");
  expect(result.ratIcon).toBe(true);
  expect(result.firstBlock).toBe("FIELDSET");
  expect(result.playerCount).toBe(0);
  expect(result.count).toBe(1);
  expect(result.options).toEqual(["world", "long", "disabled"]);
  expect(result.name).toBe("flags.probably-just-a-rat.memoryMode");
  expect(result.label).toBeTruthy();
  expect(result.effectiveLong).toBeTruthy();
  expect(result.effectiveWorld).not.toBe(result.effectiveLong);
  expect(result.effectiveDisabled).not.toBe(result.effectiveWorld);
  expect(result.labelFor).toBe(result.id);
  expect(result.hint).toBeTruthy();
});

test("boot prints render without image assets and native selection previews, cancels and saves", async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?gm");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  const original = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    return {
      image: renderer.textures.get("enemy").texture.uid,
      snapshot: __ratFixture.store.get("enemy").snapshot
    };
  });
  await page.evaluate(() => __ratFixture.openSettings());
  const select = page.locator('select[name="probably-just-a-rat.markerStyle"]');
  await select.selectOption("footprints");
  await page.waitForFunction(
    () =>
      __ratFixture.tracker.renderer.appearance().markerStyle === "footprints"
  );
  const draft = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    const marker = renderer.markers.get("enemy");
    const pixels = renderer.host.canvas.app.renderer.extract.pixels(
      marker.bakedTexture
    );
    return {
      alpha: pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0
      ),
      image: renderer.textures.get("enemy").texture.uid,
      snapshot: __ratFixture.store.get("enemy").snapshot,
      saved: renderer.host.game.settings.get(
        "probably-just-a-rat",
        "markerStyle"
      )
    };
  });
  expect(draft.alpha).toBeGreaterThan(1000);
  expect(draft.image).toBe(original.image);
  expect(draft.snapshot).toEqual(original.snapshot);
  expect(draft.saved).toBe("ghost");
  await page.evaluate(() => __ratFixture.closeSettings());
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().markerStyle === "ghost"
  );
  await page.evaluate(() => __ratFixture.openSettings());
  await select.selectOption("footprints");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () =>
      __ratFixture.tracker.host.game.settings.get(
        "probably-just-a-rat",
        "markerStyle"
      ) === "footprints"
  );
  await page.waitForFunction(() =>
    __ratFixture.tracker.renderer.markers.has("enemy")
  );
  await page.evaluate(() => __ratFixture.openSettings());
  await select.selectOption("presence");
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().markerStyle === "presence"
  );
  const neutral = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    const pixels = renderer.host.canvas.app.renderer.extract.pixels(
      renderer.markers.get("enemy").bakedTexture
    );
    return {
      alpha: pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0
      ),
      snapshot: __ratFixture.store.get("enemy").snapshot
    };
  });
  expect(neutral.alpha).toBeGreaterThan(1000);
  expect(neutral.alpha).not.toBe(draft.alpha);
  expect(neutral.snapshot).toEqual(original.snapshot);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () =>
      __ratFixture.tracker.host.game.settings.get(
        "probably-just-a-rat",
        "markerStyle"
      ) === "presence"
  );
  await page.evaluate(() => __ratFixture.move(100));
  await page.waitForFunction(() => __ratFixture.stats().markers === 0);
  expect(errors).toEqual([]);
});

test("players have no marker selector and cannot override the GM style through a local preview", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  await page.evaluate(() =>
    __ratFixture.appearance({ markerStyle: "footprints" })
  );
  await page.evaluate(() => __ratFixture.openSettings());
  await expect(
    page.locator('select[name="probably-just-a-rat.markerStyle"]')
  ).toHaveCount(0);
  const style = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    renderer.setPreview({ markerStyle: "ghost", opacity: 65 });
    renderer.sync(__ratFixture.store.records());
    return renderer.appearance();
  });
  expect(style.markerStyle).toBe("footprints");
  expect(style.opacity).toBe(0.65);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () => !document.getElementById("settings-preview-fixture")
  );
  expect(
    await page.evaluate(
      () => __ratFixture.tracker.renderer.appearance().markerStyle
    )
  ).toBe("footprints");
});

for (const markerStyle of ["footprints", "presence"])
  test(`native appearance controls affect opacity, grayscale and outline pixels for ${markerStyle}`, async ({
    page
  }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/?gm");
    await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
    await page.evaluate(() => __ratFixture.move(300));
    await page.waitForFunction(() => __ratFixture.stats().markers === 1);
    await page.evaluate(
      style =>
        __ratFixture.appearance({
          markerStyle: style,
          opacity: 50,
          grayscale: 0,
          outline: false
        }),
      markerStyle
    );
    await page.waitForFunction(() =>
      __ratFixture.tracker.renderer.markers.has("enemy")
    );
    const metrics = () =>
      page.evaluate(() => {
        const renderer = __ratFixture.tracker.renderer;
        const pixels = renderer.host.canvas.app.renderer.extract.pixels(
          renderer.markers.get("enemy").bakedTexture
        );
        let alpha = 0,
          spread = 0,
          red = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          alpha += pixels[i + 3];
          if (pixels[i + 3] > 8) {
            spread +=
              Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
              Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
            if (
              pixels[i] > pixels[i + 1] + 40 &&
              pixels[i] > pixels[i + 2] + 40
            )
              red++;
          }
        }
        return {
          alpha,
          spread,
          red,
          snapshot: __ratFixture.store.get("enemy").snapshot
        };
      });
    const original = await metrics();
    expect(original.spread).toBeGreaterThan(1000);
    await page.evaluate(() => __ratFixture.openSettings());
    const opacity = page.locator(
      'range-picker[name$=".opacity"] input[type="number"]'
    );
    await opacity.fill("30");
    await page.waitForFunction(
      () => __ratFixture.tracker.renderer.appearance().opacity === 0.3
    );
    const dim = await metrics();
    expect(dim.alpha).toBeLessThan(original.alpha * 0.8);
    await opacity.fill("80");
    await page.waitForFunction(
      () => __ratFixture.tracker.renderer.appearance().opacity === 0.8
    );
    expect((await metrics()).alpha).toBeGreaterThan(dim.alpha * 2);
    await page
      .locator('range-picker[name$=".grayscale"] input[type="number"]')
      .fill("100");
    await page.waitForFunction(
      () => __ratFixture.tracker.renderer.appearance().grayscale === 1
    );
    const gray = await metrics();
    expect(gray.spread).toBeLessThan(original.spread * 0.05);
    expect(gray.red).toBe(0);
    await page.locator('input[name$=".outline"]').check();
    await page.locator('input[name$=".outlineColor"]').fill("#ff0000");
    await page.waitForFunction(
      () =>
        __ratFixture.tracker.renderer.appearance().outlineColor === "#ff0000"
    );
    const outlined = await metrics();
    expect(outlined.red).toBeGreaterThan(10);
    expect(outlined.snapshot).toEqual(original.snapshot);
    await page.locator('input[name$=".outline"]').uncheck();
    await page.waitForFunction(
      () => !__ratFixture.tracker.renderer.appearance().outline
    );
    expect((await metrics()).red).toBe(0);
    await page.evaluate(() => __ratFixture.closeSettings());
    await page.waitForFunction(
      () => __ratFixture.tracker.renderer.appearance().opacity === 0.5
    );
    const restored = await metrics();
    expect(restored.alpha).toBe(original.alpha);
    expect(restored.spread).toBe(original.spread);
    expect(errors).toEqual([]);
  });

test("GM custom image previews, preserves aspect ratio and effects, cancels and saves without destroying shared assets", async ({
  page
}) => {
  const asset = "http://127.0.0.1:4179/custom-marker.svg";
  await page.route(asset, route =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="15" y="15" width="85" height="70" rx="8" fill="#ee8844"/><rect x="100" y="15" width="85" height="70" rx="8" fill="#4477dd"/></svg>'
    })
  );
  await page.goto("/?gm");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  await page.evaluate(() => __ratFixture.openSettings());
  const select = page.locator('select[name="probably-just-a-rat.markerStyle"]');
  await select.selectOption("custom");
  const image = page.locator(
    'file-picker[name="probably-just-a-rat.customMarkerImage"] input'
  );
  await expect(image).toBeVisible();
  await image.fill(asset);
  await page.waitForFunction(
    () =>
      __ratFixture.tracker.renderer.customImage.texture &&
      __ratFixture.tracker.renderer.markers.has("enemy")
  );
  const metrics = () =>
    page.evaluate(() => {
      const renderer = __ratFixture.tracker.renderer;
      const marker = renderer.markers.get("enemy");
      const pixels = renderer.host.canvas.app.renderer.extract.pixels(
        marker.bakedTexture
      );
      let alpha = 0,
        spread = 0,
        red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        alpha += pixels[i + 3];
        if (pixels[i + 3] > 8) {
          spread +=
            Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
            Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
          if (pixels[i] > pixels[i + 1] + 40 && pixels[i] > pixels[i + 2] + 40)
            red++;
        }
      }
      return {
        alpha,
        spread,
        red,
        x: marker.container.x,
        name: marker.snapshot.name
      };
    });
  const original = await metrics();
  expect(original.spread).toBeGreaterThan(1000);
  const geometry = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    const marker = renderer.markers.get("enemy");
    const s = renderer.customImageSnapshot(
      renderer.customImage.texture,
      marker.snapshot
    );
    __ratFixture.oldCustom = renderer.customImage.texture;
    return {
      width: s.imageWidth,
      height: s.imageHeight,
      rotation: s.rotation,
      saved: renderer.host.game.settings.get(
        "probably-just-a-rat",
        "customMarkerImage"
      )
    };
  });
  expect(geometry).toEqual({ width: 80, height: 40, rotation: 0, saved: "" });
  await page
    .locator('range-picker[name$=".opacity"] input[type="number"]')
    .fill("30");
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().opacity === 0.3
  );
  expect((await metrics()).alpha).toBeLessThan(original.alpha * 0.8);
  await page
    .locator('range-picker[name$=".grayscale"] input[type="number"]')
    .fill("100");
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().grayscale === 1
  );
  expect((await metrics()).spread).toBeLessThan(original.spread * 0.05);
  await page.locator('input[name$=".outline"]').check();
  await page.locator('input[name$=".outlineColor"]').fill("#ff0000");
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().outlineColor === "#ff0000"
  );
  expect((await metrics()).red).toBeGreaterThan(10);
  await page.evaluate(() => __ratFixture.closeSettings());
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().markerStyle === "ghost"
  );
  expect(
    await page.evaluate(
      asset => ({
        sharedValid: PIXI.Assets.get(asset).baseTexture.valid,
        ownedReleased: __ratFixture.oldCustom.baseTexture === null,
        saved: __ratFixture.tracker.host.game.settings.get(
          "probably-just-a-rat",
          "customMarkerImage"
        )
      }),
      asset
    )
  ).toEqual({ sharedValid: true, ownedReleased: true, saved: "" });
  await page.evaluate(() => __ratFixture.openSettings());
  await select.selectOption("custom");
  await image.fill(asset);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () =>
      __ratFixture.tracker.renderer.customImage.texture &&
      __ratFixture.tracker.renderer.markers.has("enemy")
  );
  expect(
    await page.evaluate(() =>
      __ratFixture.tracker.host.game.settings.get(
        "probably-just-a-rat",
        "customMarkerImage"
      )
    )
  ).toBe(asset);
  const saved = await metrics();
  expect(saved.x).toBe(original.x);
  expect(saved.name).toBe(original.name);
});

test("players cannot change the custom artwork chosen by the GM", async ({
  page
}) => {
  const asset = "http://127.0.0.1:4179/player-marker.svg";
  await page.route(asset, route =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="30" fill="#ffaa44"/></svg>'
    })
  );
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(
    asset =>
      __ratFixture.appearance({
        markerStyle: "custom",
        customMarkerImage: asset
      }),
    asset
  );
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(
    () =>
      __ratFixture.tracker.renderer.customImage.texture &&
      __ratFixture.stats().markers === 1
  );
  await page.evaluate(() => __ratFixture.openSettings());
  await expect(
    page.locator('file-picker[name="probably-just-a-rat.customMarkerImage"]')
  ).toHaveCount(0);
  const selected = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    renderer.setPreview({
      markerStyle: "ghost",
      customMarkerImage: "unapproved.webp"
    });
    renderer.sync(__ratFixture.store.records());
    return {
      style: renderer.appearance().markerStyle,
      path: renderer.customImage.src
    };
  });
  expect(selected).toEqual({ style: "custom", path: asset });
});
