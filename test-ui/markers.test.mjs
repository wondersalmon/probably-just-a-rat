import { test, expect } from "@playwright/test";

test("outline also builds from the ordinary PNG texture restored after reload", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  const restored = await page.evaluate(async () => {
    const renderer = __ratFixture.tracker.renderer;
    const data = renderer.savedImage("enemy");
    const decoded = await renderer.decodeImage(data);
    renderer.restoreImage("enemy", decoded, data);
    renderer.sync(__ratFixture.store.records());
    const pixels = renderer.host.canvas.app.renderer.extract.pixels(
      renderer.markers.get("enemy").bakedTexture
    );
    return {
      isRenderTexture: decoded instanceof PIXI.RenderTexture,
      alpha: pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0
      )
    };
  });
  expect(restored.isRenderTexture).toBe(false);
  await page.evaluate(() => __ratFixture.appearance({ outline: true }));
  await page.waitForFunction(() =>
    __ratFixture.tracker.renderer.markers.has("enemy")
  );
  const outlined = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    const entry = renderer.textures.get("enemy");
    const pixels = renderer.host.canvas.app.renderer.extract.pixels(
      renderer.markers.get("enemy").bakedTexture
    );
    return {
      mask: Boolean(entry.silhouette),
      sourceValid: entry.texture.valid,
      alpha: pixels.reduce(
        (sum, value, i) => sum + (i % 4 === 3 ? value : 0),
        0
      )
    };
  });
  expect(outlined.mask).toBe(true);
  expect(outlined.sourceValid).toBe(true);
  expect(outlined.alpha).toBeGreaterThan(restored.alpha * 1.01);
});

test("silhouette outline previews locally, keeps the frozen body and releases its owned mask", async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  const metrics = () =>
    page.evaluate(() => {
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
        x: marker.snapshot.x,
        image: renderer.textures.get("enemy").texture.uid
      };
    });
  const original = await metrics();
  await page.evaluate(() => __ratFixture.openSettings());
  await page.locator('input[name="probably-just-a-rat.outline"]').check();
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().outline
  );
  const outlined = await metrics();
  expect(outlined.alpha).toBeGreaterThan(original.alpha * 1.01);
  expect(outlined.image).toBe(original.image);
  expect(outlined.x).toBe(original.x);
  expect(
    await page.evaluate(() =>
      __ratFixture.tracker.host.game.settings.get(
        "probably-just-a-rat",
        "outline"
      )
    )
  ).toBe(false);
  await page.screenshot({ path: "dev/ghost-plain-outline.png" });
  await page.evaluate(() => __ratFixture.closeSettings());
  await page.waitForFunction(
    () => !__ratFixture.tracker.renderer.appearance().outline
  );
  expect((await metrics()).alpha).toBe(original.alpha);
  const released = await page.evaluate(() => {
    const renderer = __ratFixture.tracker.renderer;
    const source = renderer.textures.get("enemy").texture;
    const mask = renderer.textures.get("enemy").silhouette.baseTexture;
    __ratFixture.clear();
    return mask.destroyed && source.destroyed;
  });
  expect(released).toBe(true);
  expect(errors).toEqual([]);
});

test("native settings inputs preview both sliders before Save, cancel restores and Save persists", async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  const metrics = () =>
    page.evaluate(() => {
      const renderer = __ratFixture.tracker.renderer;
      const pixels = renderer.host.canvas.app.renderer.extract.pixels(
        renderer.markers.get("enemy").bakedTexture
      );
      let spread = 0,
        alpha = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        spread +=
          Math.max(...pixels.subarray(i, i + 3)) -
          Math.min(...pixels.subarray(i, i + 3));
        alpha += pixels[i + 3];
      }
      return {
        spread,
        alpha,
        saved: ["opacity", "grayscale"].map(key =>
          Number(renderer.host.game.settings.get("probably-just-a-rat", key))
        ),
        observedAt: __ratFixture.store.get("enemy").snapshot.observedAt
      };
    });
  const original = await metrics();
  await page.evaluate(() => __ratFixture.openSettings());
  // Input only: the slider is still being dragged, with no change or submit event.
  await page
    .locator('range-picker[name$=".opacity"] input[type="range"]')
    .evaluate(input => {
      input.value = "35";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page
    .locator('range-picker[name$=".grayscale"] input[type="number"]')
    .fill("100");
  await page.waitForFunction(() => {
    const appearance = __ratFixture.tracker.renderer.appearance();
    return appearance.opacity === 0.35 && appearance.grayscale === 1;
  });
  const draft = await metrics();
  expect(draft.saved).toEqual([50, 30]);
  expect(draft.spread).toBe(0);
  expect(draft.alpha / original.alpha).toBeCloseTo(0.7, 1);
  expect(draft.observedAt).toBe(original.observedAt);
  await page.evaluate(() => __ratFixture.closeSettings());
  await page.waitForFunction(
    () => __ratFixture.tracker.renderer.appearance().opacity === 0.5
  );
  const cancelled = await metrics();
  expect(cancelled.saved).toEqual([50, 30]);
  expect(cancelled.alpha).toBe(original.alpha);
  expect(cancelled.spread).toBe(original.spread);
  await page.evaluate(() => __ratFixture.openSettings());
  await page
    .locator('range-picker[name$=".opacity"] input[type="range"]')
    .press("Home");
  await page
    .locator('range-picker[name$=".grayscale"] input[type="range"]')
    .press("End");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#settings-preview-fixture")).toHaveCount(0);
  await page.waitForFunction(() => {
    const renderer = __ratFixture.tracker.renderer;
    return (
      Object.keys(renderer.preview).length === 0 &&
      renderer.appearance().opacity === 0.3
    );
  });
  const saved = await metrics();
  expect(saved.saved).toEqual([30, 100]);
  expect(saved.spread).toBe(0);
  expect(saved.alpha / original.alpha).toBeCloseTo(0.6, 1);
  expect(saved.observedAt).toBe(original.observedAt);
  expect(errors).toEqual([]);
});

test("Plain grayscale slider preserves geometry and alpha while removing color progressively", async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  const samples = [];
  for (const grayscale of [0, 50, 100]) {
    const before = await page.evaluate(
      () =>
        __ratFixture.tracker.renderer.markers.get("enemy").bakedTexture
          .baseTexture.uid
    );
    await page.evaluate(
      grayscale =>
        __ratFixture.appearance({ grayscale, opacity: 50, labels: "off" }),
      grayscale
    );
    await page.waitForFunction(before => {
      const texture =
        __ratFixture.tracker.renderer.markers.get("enemy")?.bakedTexture;
      return texture && texture.baseTexture.uid !== before;
    }, before);
    samples.push(
      await page.evaluate(() => {
        const renderer = __ratFixture.tracker.renderer;
        const marker = renderer.markers.get("enemy");
        const pixels = renderer.host.canvas.app.renderer.extract.pixels(
          marker.bakedTexture
        );
        let spread = 0,
          alpha = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          spread +=
            Math.max(...pixels.subarray(i, i + 3)) -
            Math.min(...pixels.subarray(i, i + 3));
          alpha += pixels[i + 3];
        }
        return {
          spread,
          alpha,
          width: marker.bakedTexture.width,
          height: marker.bakedTexture.height,
          parts: marker.container.children.map(child => child.name)
        };
      })
    );
    await page.screenshot({
      path: `dev/ghost-plain-grayscale-${grayscale}.png`
    });
  }
  expect(samples[0].spread).toBeGreaterThan(samples[1].spread);
  expect(samples[1].spread).toBeGreaterThan(samples[2].spread);
  expect(samples[2].spread).toBe(0);
  for (const sample of samples) {
    // A filter intermediate can round antialiased edge alpha by one byte.
    expect(Math.abs(sample.alpha / samples[0].alpha - 1)).toBeLessThan(0.001);
    expect(sample.width).toBe(samples[0].width);
    expect(sample.height).toBe(samples[0].height);
    expect(sample.parts).toEqual(["rat-ghost-baked"]);
  }
  await page.evaluate(() => __ratFixture.move(100));
  await page.waitForFunction(() => __ratFixture.stats().markers === 0);
  expect(errors).toEqual([]);
});

test("GM round counter updates without rebuilding Plain art and can be hidden", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => {
    const tracker = __ratFixture.tracker;
    tracker.store.setPolicy({ combatRounds: 0 });
    tracker.host.game.combat = {
      id: "fight",
      started: true,
      scene: { id: "scene" },
      round: 1,
      turn: 0
    };
    tracker.schedule();
  });
  await page.waitForFunction(
    () => __ratFixture.store.get("enemy")?.snapshot.combat?.round === 1
  );
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() =>
    __ratFixture.tracker.renderer.markers
      .get("enemy")
      ?.caption.children[1].text.endsWith("Rounds unseen: 0")
  );
  const before = await page.evaluate(
    () =>
      __ratFixture.tracker.renderer.markers.get("enemy").bakedTexture
        .baseTexture.uid
  );
  await page.evaluate(() => {
    __ratFixture.tracker.host.game.combat.round = 4;
    __ratFixture.tracker.schedule();
  });
  await page.waitForFunction(() =>
    __ratFixture.tracker.renderer.markers
      .get("enemy")
      .caption.children[1].text.endsWith("Rounds unseen: 3")
  );
  await page.evaluate(() => __ratFixture.appearance({ showRounds: false }));
  await page.waitForFunction(() =>
    __ratFixture.tracker.renderer.markers
      .get("enemy")
      .caption.children[1].text.endsWith("Last seen position")
  );
  expect(
    await page.evaluate(
      () =>
        __ratFixture.tracker.renderer.markers.get("enemy").bakedTexture
          .baseTexture.uid
    )
  ).toBe(before);
});

test("real PIXI renders a frozen marker, rediscovery removes it and cleanup preserves shared texture", async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(200));
  await page.waitForFunction(() => __ratFixture.stats().observedX === 200);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  for (const x of [320, 340, 360, 380, 400])
    await page.evaluate(x => __ratFixture.move(x), x);
  await expect
    .poll(() => page.evaluate(() => __ratFixture.stats().observedX))
    .toBe(200);
  expect(
    await page.evaluate(
      () =>
        __ratFixture.tracker.renderer.markers.get("enemy").container.position.x
    )
  ).toBe(200);
  expect(await page.evaluate(() => __ratFixture.stats().images)).toBe(1);
  await page.screenshot({ path: "dev/marker-fixture-en.png" });
  await page.evaluate(() => __ratFixture.move(100));
  await page.waitForFunction(() => __ratFixture.stats().markers === 0);
  await page.evaluate(() => __ratFixture.dispose());
  expect(await page.evaluate(() => __ratFixture.stats().records)).toBe(0);
  expect(
    await page.evaluate(() => __ratFixture.texture.baseTexture.destroyed)
  ).toBe(false);
  expect(errors).toEqual([]);
});

for (const language of ["en", "ru"])
  test(`native-language captions render without any memory window (${language})`, async ({
    page
  }) => {
    await page.goto(`/?lang=${language}`);
    await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
    await page.evaluate(() => __ratFixture.move(300));
    await page.waitForFunction(() => __ratFixture.stats().markers === 1);
    const text = await page.evaluate(
      () =>
        __ratFixture.tracker.renderer.markers.get("enemy").caption.children[1]
          .text
    );
    expect(text).toBe(
      `Goblin <script>unsafe</script>\n${language === "ru" ? "Последняя видимая позиция" : "Last seen position"}`
    );
    await expect(page.locator("#memory, .rat-memory")).toHaveCount(0);
    await page.evaluate(() => __ratFixture.clear());
    expect(await page.evaluate(() => __ratFixture.stats().markers)).toBe(0);
    await page.evaluate(() => __ratFixture.dispose());
  });

test("separate browser pages keep different last-observed positions", async ({
  browser
}) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await Promise.all([
    a.goto("http://127.0.0.1:4179/"),
    b.goto("http://127.0.0.1:4179/")
  ]);
  await Promise.all([
    a.waitForFunction(() => window.__ratFixture?.store.size === 1),
    b.waitForFunction(() => window.__ratFixture?.store.size === 1)
  ]);
  await b.evaluate(() => __ratFixture.move(200));
  await b.waitForFunction(() => __ratFixture.stats().observedX === 200);
  await Promise.all([
    a.evaluate(() => __ratFixture.move(300)),
    b.evaluate(() => __ratFixture.move(300))
  ]);
  await Promise.all([
    a.waitForFunction(() => __ratFixture.stats().markers === 1),
    b.waitForFunction(() => __ratFixture.stats().markers === 1)
  ]);
  expect(await a.evaluate(() => __ratFixture.stats().observedX)).toBe(100);
  expect(await b.evaluate(() => __ratFixture.stats().observedX)).toBe(200);
  await a.evaluate(() => __ratFixture.dispose());
  expect(await b.evaluate(() => __ratFixture.stats().markers)).toBe(1);
  await a.close();
  await b.close();
});

test("later Plain ghosts coexist with the first and rediscover independently", async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  for (const [id, y] of [
    ["second", 330],
    ["third", 480]
  ]) {
    await page.evaluate(({ id, y }) => __ratFixture.add(id, 100, y), { id, y });
    await page.waitForFunction(
      id => __ratFixture.store.get(id)?.state === "observed",
      id
    );
    await page.evaluate(id => __ratFixture.moveToken(id, 350), id);
    await page.waitForFunction(
      id => __ratFixture.tracker.renderer.markers.has(id),
      id
    );
  }
  expect(await page.evaluate(() => __ratFixture.stats().markers)).toBe(3);
  expect(
    await page.evaluate(
      () =>
        new Set(
          [...__ratFixture.tracker.renderer.markers.values()].map(
            marker => marker.bakedTexture
          )
        ).size
    )
  ).toBe(3);
  expect(
    await page.evaluate(() =>
      [...__ratFixture.tracker.renderer.markers.values()].every(
        marker => marker.bakedTexture && marker.filters.length === 0
      )
    )
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        new Set(
          [...__ratFixture.tracker.renderer.textures.values()].map(
            entry => entry.texture
          )
        ).size
    )
  ).toBe(3);
  await page.evaluate(() => __ratFixture.moveToken("second", 100));
  await page.waitForFunction(() => __ratFixture.stats().markers === 2);
  expect(
    await page.evaluate(() => [...__ratFixture.tracker.renderer.markers.keys()])
  ).toEqual(["enemy", "third"]);
  await page.evaluate(() => __ratFixture.dispose());
  expect(errors).toEqual([]);
});

test("remembered ping preserves coordinates and the high-contrast caption remains live", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__ratFixture?.store.size === 1);
  await page.evaluate(() => __ratFixture.move(300));
  await page.waitForFunction(() => __ratFixture.stats().markers === 1);
  await page.evaluate(() => __ratFixture.appearance({ labels: "contrast" }));
  await page.waitForFunction(
    () =>
      __ratFixture.tracker.renderer.markers.get("enemy")?.caption?.children[1]
        ?.style.fontSize === 12
  );
  expect(
    await page.evaluate(
      () =>
        __ratFixture.tracker.renderer.markers.get("enemy").bakedTexture !== null
    )
  ).toBe(true);
  await page.evaluate(() => __ratFixture.ping());
  expect(await page.evaluate(() => __ratFixture.pingCalls.at(-1))).toEqual({
    position: { x: 150, y: 180 },
    shared: true
  });
  await page.evaluate(() => __ratFixture.appearance({ sharePings: "false" }));
  await page.evaluate(() => __ratFixture.ping(true));
  expect(
    await page.evaluate(() => __ratFixture.pingCalls.at(-1))
  ).toMatchObject({
    position: { x: 150, y: 180 },
    shared: false,
    style: "alert",
    pull: false
  });
  await page.evaluate(() => __ratFixture.dispose());
});
