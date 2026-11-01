import { test, expect } from "@playwright/test";

async function settingsForm(
  page,
  gm = true,
  captionStyle = "standard",
  systemId = "dnd5e",
  language = "ru"
) {
  await page.goto(`/?lang=${language}&system=${systemId}${gm ? "&gm" : ""}`);
  await page.waitForFunction(() => window.__ratFixture?.tracker.context);
  await page.addStyleTag({ url: "/styles/control-panel.css" });
  await page.evaluate(
    async ({ gm, captionStyle }) => {
      const { tracker } = __ratFixture;
      __ratFixture.move(300);
      await __ratFixture.appearance({ captionStyle });
      tracker.clearMemory();
      const { SettingsPreview } =
        await import("/scripts/foundry/settings-preview.js");
      const { registerSettings } = await import("/scripts/settings.js");
      const definitions = [];
      registerSettings(
        {
          register: (_namespace, key, config) =>
            definitions.push({ key, ...config })
        },
        () => {},
        undefined,
        undefined,
        undefined,
        tracker.host.game.system?.id
      );
      const form = document.createElement("form");
      form.id = "review-settings";
      form.style.cssText =
        "position:absolute;top:0;left:0;width:520px;background:#222;padding:12px;z-index:10";
      const section = document.createElement("section");
      section.dataset.category = "probably-just-a-rat";
      form.append(section);
      for (const config of definitions) {
        if (!gm && config.scope === "world") continue;
        const group = document.createElement("div");
        group.className = "form-group";
        const label = document.createElement("label");
        label.textContent = tracker.host.game.i18n.localize(config.name);
        const fields = document.createElement("div");
        fields.className = "form-fields";
        const field = document.createElement(
          config.choices ? "select" : "input"
        );
        field.name = `probably-just-a-rat.${config.key}`;
        if (config.choices) {
          for (const [value, key] of Object.entries(config.choices)) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = tracker.host.game.i18n.localize(key);
            field.append(option);
          }
        } else
          field.type =
            config.type === Boolean
              ? "checkbox"
              : config.type === Number
                ? "number"
                : "text";
        const value = tracker.host.game.settings.get(
          "probably-just-a-rat",
          config.key
        );
        if (field.type === "checkbox") field.checked = Boolean(value);
        else field.value = String(value);
        fields.append(field);
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = tracker.host.game.i18n.localize(config.hint);
        group.append(label, fields, hint);
        section.append(group);
      }
      document.body.append(form);
      const preview = new SettingsPreview(tracker.host, values => {
        if (tracker.renderer.setPreview(values))
          tracker.renderer.sync(tracker.store.records());
      });
      preview.mount({}, form);
      window.__reviewPreview = preview;
      const save = document.createElement("button");
      save.type = "submit";
      save.textContent = "Save";
      form.append(save);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        // Reduced Foundry FormDataExtended boundary: DOM field order, disabled
        // fields omitted, typed values and the native formdata event.
        const object = {};
        for (const input of form.elements) {
          if (!input.name || input.disabled) continue;
          const config = definitions.find(
            config => input.name === `probably-just-a-rat.${config.key}`
          );
          if (!config) continue;
          object[input.name] =
            input.type === "checkbox"
              ? input.checked
              : config.type === Number
                ? Number(input.value)
                : input.value;
        }
        const submission = new Event("formdata");
        Object.defineProperty(submission, "formData", { value: { object } });
        form.dispatchEvent(submission);
        for (const [name, value] of Object.entries(object))
          await tracker.host.game.settings.set(
            "probably-just-a-rat",
            name.slice("probably-just-a-rat.".length),
            value
          );
        const { configureLocalization } =
          await import("/scripts/localization.js");
        await configureLocalization(tracker.host);
        preview.refreshLanguage();
        preview.refreshCaptionPolicy();
        window.__reviewSaved = true;
      });
    },
    { gm, captionStyle }
  );
}

for (const language of ["en", "ru"])
  test(`Daggerheart settings preserve saved limits and preview encounter mode without applying it (${language})`, async ({
    page
  }) => {
    await settingsForm(page, true, "standard", "daggerheart", language);
    const root = page.locator("#review-settings");
    const mode = root.locator('[name$=".daggerheartCombatMemory"]');
    const rounds = root.locator('[name$=".memoryRounds"]');
    const counter = root.locator('[name$=".showRounds"]');
    const caption = root.locator(".rat-preview-caption");
    const stepText =
      language === "ru"
        ? "Прошло шагов spotlight: 1"
        : "Spotlight steps unseen: 1";
    await expect(caption).toContainText(stepText);
    await root.locator('[data-rat-settings-tab="memory"]').click();
    await expect(mode).toHaveValue("steps");
    await expect(rounds).toBeVisible();
    await expect(
      root.locator("label").filter({
        hasText:
          language === "ru"
            ? "Срок в столкновении (шаги spotlight)"
            : "Encounter lifetime (spotlight steps)"
      })
    ).toBeVisible();
    await rounds.fill("0");
    expect(await rounds.evaluate(input => input.checkValidity())).toBe(false);
    await mode.selectOption("encounter");
    await expect(rounds).toBeHidden();
    await expect(rounds).toBeDisabled();
    expect(await rounds.evaluate(input => input.validationMessage)).toBe("");
    await expect(counter).toBeDisabled();
    await expect(caption).not.toContainText(stepText);
    expect(
      await page.evaluate(() =>
        __ratFixture.tracker.host.game.settings.get(
          "probably-just-a-rat",
          "daggerheartCombatMemory"
        )
      )
    ).toBe("steps");
    await page.evaluate(() => {
      const preview = window.__reviewPreview;
      const [app] = preview.bindings.keys();
      preview.mount(app, document.getElementById("review-settings"));
    });
    await expect(mode).toHaveValue("encounter");
    await expect(rounds).toBeDisabled();
    await root.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.__reviewSaved);
    expect(
      await page.evaluate(() =>
        __ratFixture.tracker.host.game.settings.get(
          "probably-just-a-rat",
          "daggerheartCombatMemory"
        )
      )
    ).toBe("encounter");
    expect(
      await page.evaluate(() =>
        __ratFixture.tracker.host.game.settings.get(
          "probably-just-a-rat",
          "memoryRounds"
        )
      )
    ).toBe(2);
    expect(
      await page.evaluate(() =>
        __ratFixture.tracker.host.game.settings.get(
          "probably-just-a-rat",
          "showRounds"
        )
      )
    ).toBe(true);
    await mode.selectOption("steps");
    await expect(rounds).toBeEnabled();
    await expect(rounds).toBeVisible();
    expect(await rounds.evaluate(input => input.checkValidity())).toBe(false);
    await rounds.fill("3");
    expect(await rounds.evaluate(input => input.checkValidity())).toBe(true);
    await root.locator('[data-rat-settings-tab="marker"]').click();
    await expect(caption).toContainText(stepText);
  });

test("Daggerheart scene summaries describe the selected expiry mode and Long memory", async ({
  page
}) => {
  await settingsForm(page, true, "standard", "daggerheart");
  await page.evaluate(async () => {
    const { addSceneMemoryOptions } =
      await import("/scripts/foundry/scene-config.js");
    const { host } = __ratFixture.tracker;
    host.document = document;
    const root = document.createElement("section");
    root.id = "dh-scene-memory";
    root.className = "tab";
    root.dataset.tab = "visibility";
    document.body.append(root);
    const app = {
      id: "dh-scene",
      isEditable: true,
      document: { isOwner: true }
    };
    addSceneMemoryOptions(host, app, root);
    await host.game.settings.set(
      "probably-just-a-rat",
      "daggerheartCombatMemory",
      "encounter"
    );
    root.querySelector("select").dispatchEvent(new Event("change"));
  });
  const root = page.locator("#dh-scene-memory");
  await expect(root.locator(".rat-scene-effective-rules")).toContainText(
    "до его завершения"
  );
  await root.locator("select").selectOption("long");
  await expect(root.locator(".rat-scene-effective-rules")).toContainText(
    "Без сроков"
  );
  await expect(root.locator(".rat-scene-effective-rules")).not.toContainText(
    "шагов spotlight"
  );
});

test("GM settings organize three tabs, native rules and all preview effects", async ({
  page
}) => {
  await settingsForm(page);
  const root = page.locator("#review-settings");
  const marker = root.locator('[data-rat-settings-tab="marker"]');
  const memory = root.locator('[data-rat-settings-tab="memory"]');
  const general = root.locator('[data-rat-settings-tab="general"]');
  await expect(root.getByRole("tab")).toHaveCount(3);
  await expect(marker).toHaveText("Маркер");
  await expect(memory).toHaveText("Правила памяти");
  await expect(general).toHaveText("Общие");
  await expect(marker).toHaveAttribute("aria-selected", "true");
  await expect(root.locator('[name$=".memoryRounds"]')).toBeHidden();
  await expect(root.locator('[name$=".language"]')).toBeHidden();
  await expect(
    root.getByText("Мой внешний вид", { exact: true })
  ).toBeVisible();
  await expect(root.getByText("Предпросмотр", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => __ratFixture.store.size)).toBe(0);
  await expect(
    root.locator('.rat-outline-row [name$=".outlineColor"]')
  ).toHaveCount(1);
  await expect(root.locator('[name$=".labels"]')).toBeHidden();

  const image = root.locator('[name$=".customMarkerImage"]');
  const rotation = root.locator('[name$=".customMarkerRotate"]');
  await expect(image).toBeHidden();
  await expect(rotation).toBeVisible();
  for (const style of ["ghost", "footprints", "presence", "custom"]) {
    await root.locator('[name$=".markerStyle"]').selectOption(style);
    await expect(rotation).toBeVisible();
    await rotation.check();
    await expect(root.locator(".rat-preview-image")).not.toHaveCSS(
      "transform",
      "none"
    );
    await rotation.uncheck();
    await expect(root.locator(".rat-preview-image")).toHaveCSS(
      "transform",
      "none"
    );
  }
  await root.locator('[name$=".markerStyle"]').selectOption("custom");
  await expect(image).toBeVisible();
  await expect(rotation).toBeVisible();
  await rotation.check();
  await expect(root.locator(".rat-preview-image")).not.toHaveCSS(
    "transform",
    "none"
  );
  const captionStyle = root.locator('[name$=".captionStyle"]');
  await captionStyle.selectOption("off");
  await expect(root.locator(".rat-preview-caption")).toBeHidden();
  await captionStyle.selectOption("contrast");
  await expect
    .poll(() =>
      page.evaluate(
        () => __ratFixture.tracker.renderer.appearance().highContrast
      )
    )
    .toBe(true);
  await expect(root.locator(".rat-preview-caption")).toHaveClass(
    /rat-preview-caption-contrast/
  );
  await captionStyle.selectOption("standard");
  await expect(root.locator(".rat-preview-caption")).not.toHaveClass(
    /rat-preview-caption-contrast/
  );
  await root.locator('[name$=".opacity"]').fill("65");
  await root.locator('[name$=".grayscale"]').fill("100");
  await expect(root.locator(".rat-preview-image")).toHaveCSS("opacity", "0.65");
  await expect(root.locator(".rat-preview-image")).toHaveCSS(
    "filter",
    "grayscale(1)"
  );
  await root.locator('[name$=".markerStyle"]').selectOption("ghost");
  await root
    .locator(".rat-settings-preview")
    .screenshot({ path: "dev/settings-review-preview-ru.png" });

  await memory.click();
  await expect(memory).toHaveAttribute("aria-selected", "true");
  await expect(root.locator('[name$=".markerStyle"]')).toBeHidden();
  await expect(root.locator(".rat-rule-select")).toHaveCount(2);
  await root.locator('[name$=".rememberHidden"]').evaluate(field => {
    const select = field.parentElement.querySelector("select");
    select.value = "true";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(root.locator('[name$=".rememberHidden"]')).toBeChecked();
  expect(
    await page.evaluate(() =>
      __ratFixture.tracker.host.game.settings.get(
        "probably-just-a-rat",
        "rememberHidden"
      )
    )
  ).toBe(false);
  const rounds = root.locator('[name$=".memoryRounds"]');
  for (const invalid of ["0", "-1", "1.5", ""]) {
    await rounds.fill(invalid);
    expect(await rounds.evaluate(input => input.checkValidity())).toBe(false);
    expect(await rounds.evaluate(input => input.validationMessage)).toContain(
      "целое"
    );
  }
  await rounds.fill("3");
  expect(await rounds.evaluate(input => input.checkValidity())).toBe(true);
  const minutes = root.locator('[name$=".memoryMinutes"]');
  await minutes.fill("-5");
  expect(await minutes.evaluate(input => input.checkValidity())).toBe(false);
  await minutes.fill("0.5");
  expect(await minutes.evaluate(input => input.checkValidity())).toBe(true);
  expect(
    await page.evaluate(() =>
      __ratFixture.tracker.host.game.settings.get(
        "probably-just-a-rat",
        "memoryRounds"
      )
    )
  ).toBe(2);
  await general.click();
  await expect(root.locator('[name$=".language"]')).toBeVisible();
  await expect(root.locator(".rat-caption-content")).toBeVisible();
  await expect(root.locator('[name$=".showNames"]')).toBeVisible();
  await expect(root.locator('[name$=".showRounds"]')).toBeVisible();
});

test("players have one personal block and readable caption choices without an off option", async ({
  page
}) => {
  await settingsForm(page, false);
  const root = page.locator("#review-settings");
  await expect(root.getByRole("tab")).toHaveCount(0);
  await expect(root.locator(".rat-settings-menu")).toHaveCount(0);
  await expect(root.locator(".rat-settings-section")).toHaveCount(1);
  await expect(root.getByText("Мои настройки", { exact: true })).toBeVisible();
  await expect(root.locator('[name$=".language"]')).toBeVisible();
  await expect(root.locator('[name$=".markerStyle"]')).toHaveCount(0);
  await expect(root.locator('[name$=".captionStyle"]')).toHaveCount(0);
  const raw = root.locator('[name$=".labels"]');
  await expect(raw).toBeHidden();
  await expect(raw).toHaveValue("world");
  const select = root.locator(".rat-personal-caption-style");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveCount(2);
  expect(
    await select
      .locator("option")
      .evaluateAll(options => options.map(option => option.value))
  ).toEqual(["standard", "contrast"]);
  await select.selectOption("contrast");
  await expect(raw).toHaveValue("contrast");
  await expect
    .poll(() =>
      page.evaluate(
        () => __ratFixture.tracker.renderer.appearance().highContrast
      )
    )
    .toBe(true);
  await select.selectOption("standard");
  await expect
    .poll(() =>
      page.evaluate(() => __ratFixture.tracker.renderer.appearance().labels)
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      __ratFixture.tracker.host.game.settings.get(
        "probably-just-a-rat",
        "labels"
      )
    )
  ).toBe("world");
  await page.evaluate(() => window.__reviewPreview.dispose());
  await expect
    .poll(() =>
      page.evaluate(
        () => __ratFixture.tracker.renderer.appearance().highContrast
      )
    )
    .toBe(false);
});

test("GM caption off hides the player style control while world contrast seeds the default", async ({
  page
}) => {
  await settingsForm(page, false, "off");
  const root = page.locator("#review-settings");
  await expect(root.locator(".rat-personal-caption-style")).toBeHidden();
  await expect(root.locator('[name$=".labels"]')).toBeDisabled();
  await expect(root.locator(".rat-preview-caption")).toBeHidden();
  await page.evaluate(async () => {
    await __ratFixture.appearance({ captionStyle: "contrast" });
    window.__reviewPreview.refreshCaptionPolicy();
  });
  await expect(root.locator(".rat-personal-caption-style")).toBeVisible();
  await expect(root.locator(".rat-personal-caption-style")).toHaveValue(
    "contrast"
  );
  await expect(root.locator('[name$=".labels"]')).toHaveValue("world");
  await expect(root.locator(".rat-preview-caption")).toHaveClass(
    /rat-preview-caption-contrast/
  );
});

test("module language changes after Save while native Foundry language stays unchanged", async ({
  page
}) => {
  await settingsForm(page, false);
  const root = page.locator("#review-settings");
  await root.locator('[name$=".language"]').selectOption("en");
  await expect(root.getByText("Мои настройки", { exact: true })).toBeVisible();
  await root.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => window.__reviewSaved);
  await expect(root.getByText("My settings", { exact: true })).toBeVisible();
  await expect(root.getByText("Preview", { exact: true })).toBeVisible();
  await expect(root.locator(".rat-personal-caption-style option")).toHaveText([
    "Standard",
    "High contrast"
  ]);
  expect(
    await page.evaluate(() =>
      __ratFixture.tracker.host.game.i18n.localize("RAT.Settings.Preview.Title")
    )
  ).toBe("Предпросмотр");
});

test("GM eye opens scene visibility settings and player panel omits it", async ({
  page
}) => {
  await settingsForm(page);
  await page.evaluate(async () => {
    window.__reviewPreview.dispose();
    document.getElementById("review-settings").remove();
    const host = __ratFixture.tracker.host;
    const calls = (window.__sceneSheetCalls = []);
    host.canvas.scene.isOwner = true;
    host.canvas.scene.sheet = {
      isEditable: true,
      rendered: false,
      minimized: false,
      render: async options => {
        calls.push(options);
      },
      bringToFront: () => calls.push("front")
    };
    const { RatControlPanel } =
      await import("/scripts/foundry/control-panel.js");
    const panel = new RatControlPanel(
      host,
      { list: () => [], status: () => null },
      () => {}
    );
    panel.open = true;
    panel.window = { render: () => {} };
    document.body.append(panel.build());
  });
  const eye = page.locator('[data-rat-action="scene-visibility"]');
  await expect(eye).toBeEnabled();
  await expect(eye.locator(".fa-eye")).toHaveCount(1);
  await eye.click();
  await expect
    .poll(() => page.evaluate(() => window.__sceneSheetCalls))
    .toEqual([{ force: true, tab: { sheet: "visibility" } }, "front"]);
  await page.evaluate(async () => {
    document.querySelector(".rat-controls-body").remove();
    const host = __ratFixture.tracker.host;
    host.game.user.isGM = false;
    const { RatControlPanel } =
      await import("/scripts/foundry/control-panel.js");
    document.body.append(
      new RatControlPanel(
        host,
        { list: () => [], status: () => null },
        () => {}
      ).build()
    );
  });
  await expect(eye).toHaveCount(0);
});
