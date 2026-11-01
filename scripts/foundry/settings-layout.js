import { MODULE_ID } from "../constants.js";
import { resolveAppearance, resolveCaptionStyle } from "../appearance.js";
import { isMemoryDurationValid } from "../settings.js";
import { localize as translate, format } from "../localization.js";
import { openCurrentSceneMemorySettings } from "./scene-config.js";
import { encounterMemory, memoryTextKey } from "../system-profile.js";

let settingsMenuSequence = 0;

/** Preserve native named inputs and submission while organizing their presentation.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {HTMLElement} root
 * @param {string} [activeSection]
 */
export function organizeSettings(host, root, activeSection = "marker") {
  const document = root.ownerDocument;
  if (!document?.createElement || root.querySelector(".rat-settings-section"))
    return;
  /** @param {string} key */
  const localize = key => translate(host, key);
  /** @param {string} key */
  const field = key => root.querySelector(`[name="${MODULE_ID}.${key}"]`);
  /** @param {string} key */
  const group = key => field(key)?.closest(".form-group");
  const first = group("markerStyle") ?? group("opacity") ?? group("language");
  if (!first?.parentNode) return;
  const container = first.parentNode;
  const anchor = document.createComment("rat-settings");
  container.insertBefore(anchor, first);
  const browser = document.createElement("div");
  browser.className = "rat-settings-browser";
  const menu = document.createElement("nav");
  menu.className = "rat-settings-menu";
  menu.setAttribute("role", "tablist");
  menu.setAttribute("aria-label", localize("RAT.Settings.Menu.Label"));
  const content = document.createElement("div");
  content.className = "rat-settings-panels";
  if (host.game.user.isGM) browser.append(menu);
  browser.append(content);
  container.insertBefore(browser, anchor);
  const menuId = "rat-settings-" + ++settingsMenuSequence;
  /** @type {Map<string, {button: HTMLButtonElement, panel: HTMLElement}>} */
  const panels = new Map();
  const sections = host.game.user.isGM
    ? [
        {
          id: "general",
          title: "General",
          groups: [
            { title: "General", keys: ["language"] },
            {
              title: "Captions",
              keys: ["showNames", "showRounds", "sharePings"]
            }
          ]
        },
        {
          id: "marker",
          title: "Marker",
          groups: [
            {
              title: "Marker",
              keys: [
                "markerStyle",
                "customMarkerRotate",
                "customMarkerImage",
                "captionStyle"
              ]
            },
            {
              title: "Appearance",
              keys: [
                "opacity",
                "grayscale",
                "outline",
                "outlineColor",
                "labels"
              ]
            }
          ]
        },
        {
          id: "memory",
          title: "Memory",
          groups: [
            {
              title: "Memory",
              keys: [
                "combatOnly",
                "daggerheartCombatMemory",
                "memoryRounds",
                "memoryMinutes",
                "rememberHidden"
              ]
            }
          ]
        }
      ]
    : [
        {
          id: "personal",
          title: "Appearance",
          groups: [
            {
              title: "Personal",
              keys: [
                "language",
                "opacity",
                "grayscale",
                "outline",
                "outlineColor",
                "labels"
              ]
            }
          ]
        }
      ];
  /** @param {string} id @param {boolean} [focus] */
  const activate = (id, focus = false) => {
    if (!panels.has(id)) return;
    root.dataset.ratSettingsSection = id;
    for (const [key, { button, panel }] of panels) {
      const selected = key === id;
      panel.hidden = !selected;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
  };
  for (const { id, title, groups } of sections) {
    const panel = document.createElement("div");
    panel.className = "rat-settings-panel";
    panel.dataset.ratSettingsPanel = id;
    panel.id = menuId + "-" + id + "-panel";
    if (host.game.user.isGM) panel.setAttribute("role", "tabpanel");
    const button = document.createElement("button");
    button.type = "button";
    button.id = menuId + "-" + id + "-tab";
    button.dataset.ratSettingsTab = id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id);
    button.textContent = host.game.user.isGM
      ? localize(`RAT.Settings.Menu.${title}`)
      : localize("RAT.Settings.Sections.Personal");
    if (host.game.user.isGM) panel.setAttribute("aria-labelledby", button.id);
    for (const definition of groups) {
      const items = definition.keys.map(group).filter(Boolean);
      if (!items.length) continue;
      const section = document.createElement("fieldset");
      section.className = "rat-settings-section";
      section.dataset.ratSettingsGroup = definition.title;
      const legend = document.createElement("legend");
      legend.textContent = localize(
        `RAT.Settings.Sections.${definition.title}`
      );
      section.append(legend);
      for (const item of items) if (item) section.append(item);
      panel.append(section);
    }
    if (!panel.children.length) continue;
    panels.set(id, { button, panel });
    menu.append(button);
    content.append(panel);
    button.addEventListener("click", () => activate(id));
    button.addEventListener("keydown", event => {
      const keys = [...panels.keys()];
      const index = keys.indexOf(id);
      let next = index;
      if (event.key === "ArrowRight" || event.key === "ArrowDown")
        next = (index + 1) % keys.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (index - 1 + keys.length) % keys.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = keys.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      activate(keys[next], true);
    });
  }
  activate(panels.has(activeSection) ? activeSection : [...panels.keys()][0]);
  // Native form validation must reveal a field before the browser focuses it.
  browser.addEventListener(
    "invalid",
    event => {
      const target = /** @type {HTMLElement | null} */ (event.target);
      const panel = target?.closest?.("[data-rat-settings-panel]");
      const id = panel?.getAttribute("data-rat-settings-panel");
      if (id) activate(id);
    },
    true
  );
  for (const key of ["rememberHidden", "combatOnly"]) {
    const input = /** @type {HTMLInputElement | null} */ (field(key));
    if (!input || input.type !== "checkbox") continue;
    const select = document.createElement("select");
    select.className = "rat-rule-select";
    select.setAttribute("aria-label", localize(`RAT.Settings.${key}.Name`));
    for (const value of ["false", "true"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = localize(`RAT.Settings.${key}.${value}`);
      select.append(option);
    }
    select.value = String(input.checked);
    select.addEventListener("change", () => {
      input.checked = select.value === "true";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    input.hidden = true;
    input.style.display = "none";
    input.after(select);
    const label = group(key)?.querySelector("label");
    if (label) {
      select.id = `${input.id || `${MODULE_ID}-${key}`}-choice`;
      label.setAttribute("for", select.id);
    }
  }
  const outline = group("outline"),
    color = group("outlineColor");
  if (outline && color) {
    outline.classList.add("rat-outline-row");
    color.classList.add("rat-outline-color");
    outline.append(color);
  }
  const names = group("showNames"),
    rounds = group("showRounds");
  if (names && rounds) {
    const content = document.createElement("fieldset");
    content.className = "rat-caption-content";
    const legend = document.createElement("legend");
    legend.textContent = localize("RAT.Settings.CaptionContent");
    content.append(legend);
    names.before(content);
    content.append(names, rounds);
  }
  const preview = document.createElement("figure");
  preview.className = "rat-settings-preview";
  const title = document.createElement("figcaption");
  title.textContent = localize("RAT.Settings.Preview.Title");
  const stage = document.createElement("div");
  stage.className = "rat-preview-stage";
  const image = document.createElement("img");
  image.className = "rat-preview-image";
  image.alt = "";
  const caption = document.createElement("span");
  caption.className = "rat-preview-caption";
  stage.append(image, caption);
  const hint = document.createElement("small");
  hint.textContent = localize("RAT.Settings.Preview.Hint");
  const illustration = document.createElement("p");
  illustration.className = "hint rat-preview-illustration-hint";
  preview.append(title, stage, illustration, hint);
  const markerPanel =
    panels.get("marker")?.panel ?? panels.get("personal")?.panel;
  const appearance = markerPanel?.querySelector(
    '[data-rat-settings-group="Appearance"], [data-rat-settings-group="Personal"]'
  );
  if (markerPanel) markerPanel.insertBefore(preview, appearance ?? null);
  const memoryPanel = panels.get("memory")?.panel;
  if (memoryPanel && host.game.user.isGM) {
    const link = document.createElement("div");
    link.className = "rat-scene-settings-link";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rat-open-scene-settings";
    const hint = document.createElement("p");
    hint.className = "hint";
    link.append(button, hint);
    memoryPanel.append(link);
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        if (!(await openCurrentSceneMemorySettings(host)))
          host.ui.notifications.warn(
            translate(host, "RAT.Settings.SceneMemory.Unavailable")
          );
      } catch {
        host.ui.notifications.warn(
          translate(host, "RAT.Settings.SceneMemory.Failed")
        );
      } finally {
        updateSceneMemoryLink(host, root);
      }
    });
    updateSceneMemoryLink(host, root);
  }
  anchor.remove();
}

/** Show the GM policy or the player's two permitted personal styles.
 * The named native field retains the inheritance sentinel until the player chooses.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {HTMLElement} root
 * @param {Record<string, any>} [draft]
 */
export function updateCaptionControls(host, root, draft = {}) {
  const input = /** @type {HTMLSelectElement | null} */ (
    root.querySelector('[name="' + MODULE_ID + '.labels"]')
  );
  const group = /** @type {HTMLElement | null | undefined} */ (
    input?.closest?.(".form-group")
  );
  if (!input || !group) return;
  const world =
    (host.game.user.isGM ? draft.captionStyle : undefined) ??
    host.game.settings.get(MODULE_ID, "captionStyle");
  const available = !host.game.user.isGM && world !== "off";
  group.hidden = !available;
  group.style.display = available ? "" : "none";
  input.disabled = !available;
  input.hidden = true;
  input.style.display = "none";
  let select = /** @type {HTMLSelectElement | null} */ (
    group.querySelector(".rat-personal-caption-style")
  );
  if (!select && root.ownerDocument) {
    select = root.ownerDocument.createElement("select");
    select.className = "rat-personal-caption-style";
    select.id = (input.id || MODULE_ID + "-labels") + "-choice";
    for (const value of ["standard", "contrast"]) {
      const option = root.ownerDocument.createElement("option");
      option.value = value;
      select.append(option);
    }
    input.after(select);
    const label = group.querySelector("label");
    if (label) label.setAttribute("for", select.id);
    const choice = select;
    select.addEventListener("change", () => {
      input.value = choice.value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  if (!select) return;
  select.disabled = !available;
  select.value = resolveCaptionStyle(world, draft.labels ?? input.value, false);
  select.setAttribute(
    "aria-label",
    translate(host, "RAT.Settings.labels.Name")
  );
  for (const option of select.options)
    option.textContent = translate(
      host,
      option.value === "contrast"
        ? "RAT.Caption.Contrast"
        : "RAT.Caption.Standard"
    );
}

/** Keep the shortcut in sync when the viewed scene changes.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {HTMLElement} root
 */
export function updateSceneMemoryLink(host, root) {
  const button = /** @type {HTMLButtonElement | null} */ (
    root.querySelector(".rat-open-scene-settings")
  );
  if (!button) return;
  const scene = host.canvas?.scene;
  const available = Boolean(
    host.game.user.isGM && host.canvas?.ready && scene?.isOwner
  );
  button.disabled = !available;
  button.textContent = translate(host, "RAT.Settings.SceneMemory.Open");
  const hint = root.querySelector(".rat-scene-settings-link > .hint");
  if (hint)
    hint.textContent = available
      ? format(host, "RAT.Settings.SceneMemory.Hint", {
          scene: scene.name ?? ""
        })
      : translate(host, "RAT.Settings.SceneMemory.Unavailable");
}

/** Translate only this module's native controls; Foundry keeps its own language.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {HTMLElement} root
 */
export function translateSettings(host, root) {
  /** @type {Record<string, Record<string, string>>} */
  const choices = {
    language: {
      foundry: "RAT.Language.Foundry",
      en: "RAT.Language.English",
      ru: "RAT.Language.Russian"
    },
    markerStyle: {
      ghost: "RAT.MarkerStyle.Ghost",
      footprints: "RAT.MarkerStyle.Footprints",
      presence: "RAT.MarkerStyle.Presence",
      custom: "RAT.MarkerStyle.Custom"
    },
    captionStyle: {
      off: "RAT.Caption.Off",
      standard: "RAT.Caption.Standard",
      contrast: "RAT.Caption.Contrast"
    },
    labels: {
      world: "RAT.Caption.World",
      standard: "RAT.Caption.Standard",
      contrast: "RAT.Caption.Contrast"
    },
    sharePings: {
      false: "RAT.PingAudience.Local",
      true: "RAT.PingAudience.Shared"
    },
    daggerheartCombatMemory: {
      steps: "RAT.Daggerheart.Mode.Steps",
      encounter: "RAT.Daggerheart.Mode.Encounter"
    }
  };
  for (const field of root.querySelectorAll?.('[name^="' + MODULE_ID + '."]') ??
    []) {
    const key = field.getAttribute("name")?.slice(MODULE_ID.length + 1);
    if (!key) continue;
    const group = field.closest(".form-group");
    const label = group?.querySelector(":scope > label");
    const hint = group?.querySelector(":scope > .hint");
    if (label)
      label.textContent = translate(
        host,
        memoryTextKey(host.game.system?.id, `RAT.Settings.${key}.Name`)
      );
    if (hint)
      hint.textContent = translate(
        host,
        memoryTextKey(host.game.system?.id, `RAT.Settings.${key}.Hint`)
      );
    for (const option of field.querySelectorAll("option")) {
      const translation = choices[key]?.[option.value];
      if (translation) option.textContent = translate(host, translation);
    }
    const rule = group?.querySelector(".rat-rule-select");
    if (rule) {
      rule.setAttribute(
        "aria-label",
        translate(host, `RAT.Settings.${key}.Name`)
      );
      for (const option of rule.querySelectorAll("option"))
        option.textContent = translate(
          host,
          `RAT.Settings.${key}.${option.value}`
        );
    }
  }
  /** @type {Record<string, string>} */
  const menuTitles = {
    general: "General",
    marker: "Marker",
    memory: "Memory",
    captions: "Captions"
  };
  for (const button of root.querySelectorAll?.("[data-rat-settings-tab]") ??
    []) {
    const title =
      menuTitles[button.getAttribute("data-rat-settings-tab") ?? ""];
    if (title)
      button.textContent = translate(host, `RAT.Settings.Menu.${title}`);
  }
  root
    .querySelector(".rat-settings-menu")
    ?.setAttribute?.("aria-label", translate(host, "RAT.Settings.Menu.Label"));
  for (const section of root.querySelectorAll?.("[data-rat-settings-group]") ??
    []) {
    const legend = section.querySelector(":scope > legend");
    if (legend)
      legend.textContent = translate(
        host,
        `RAT.Settings.Sections.${section.getAttribute("data-rat-settings-group")}`
      );
  }
  updateSceneMemoryLink(host, root);
  const captionLegend = root.querySelector(".rat-caption-content > legend");
  if (captionLegend)
    captionLegend.textContent = translate(host, "RAT.Settings.CaptionContent");
  const title = root.querySelector(".rat-settings-preview > figcaption");
  if (title) title.textContent = translate(host, "RAT.Settings.Preview.Title");
  const hint = root.querySelector(".rat-settings-preview > small");
  if (hint) hint.textContent = translate(host, "RAT.Settings.Preview.Hint");
}

/** @param {import("../../types/foundry.js").FoundryHost} host @param {HTMLElement} root */
export function validateMemoryInputs(host, root) {
  for (const key of ["memoryRounds", "memoryMinutes"]) {
    const input = /** @type {HTMLInputElement | null} */ (
      root.querySelector(`input[name="${MODULE_ID}.${key}"]`)
    );
    if (!input?.setCustomValidity) continue;
    if (input.disabled) {
      input.setCustomValidity("");
      continue;
    }
    input.required = true;
    input.min = key === "memoryRounds" ? "1" : "0";
    input.step = key === "memoryRounds" ? "1" : "any";
    input.setCustomValidity(
      isMemoryDurationValid(key, input.value === "" ? NaN : Number(input.value))
        ? ""
        : translate(
            host,
            memoryTextKey(
              host.game.system?.id,
              `RAT.Settings.${key}.Validation`
            )
          )
    );
  }
}

/** Hide inactive counter controls without discarding their saved values.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {HTMLElement} root
 * @param {Record<string, any>} [draft]
 */
export function updateCombatMemoryControls(host, root, draft = {}) {
  const encounter = encounterMemory(
    host.game.settings,
    host.game.system?.id,
    draft.daggerheartCombatMemory
  );
  for (const key of ["memoryRounds", "showRounds"]) {
    const field = /** @type {HTMLInputElement | null} */ (
      root.querySelector(`[name="${MODULE_ID}.${key}"]`)
    );
    const group = /** @type {HTMLElement | undefined | null} */ (
      field?.closest?.(".form-group")
    );
    if (group) {
      group.hidden = encounter;
      group.style.display = encounter ? "none" : "";
    }
    if (field) field.disabled = encounter;
  }
}

/** A sample available without a canvas or remembered enemies.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {HTMLElement} root @param {Record<string, any>} draft
 */
export function updateSettingsSample(host, root, draft) {
  const stage = /** @type {HTMLElement | null} */ (
    root.querySelector(".rat-preview-stage")
  );
  if (!stage?.querySelector) return;
  /** @param {string} key */
  const get = key => draft[key] ?? host.game.settings.get(MODULE_ID, key);
  const appearance = resolveAppearance(
    /** @type {any} */ ({
      ...Object.fromEntries(
        [
          "markerStyle",
          "customMarkerImage",
          "customMarkerRotate",
          "opacity",
          "grayscale",
          "outline",
          "outlineColor",
          "labels"
        ].map(key => [key, get(key)])
      ),
      labels: resolveCaptionStyle(
        (host.game.user.isGM ? draft.captionStyle : undefined) ??
          host.game.settings.get(MODULE_ID, "captionStyle"),
        get("labels"),
        host.game.user.isGM
      )
    })
  );
  const illustration = /** @type {HTMLElement | null} */ (
    root.querySelector(".rat-preview-illustration-hint")
  );
  if (illustration) {
    illustration.hidden = appearance.markerStyle === "custom";
    illustration.textContent = translate(
      host,
      "RAT.Settings.Preview.Illustrative"
    );
  }
  const image = /** @type {HTMLImageElement} */ (stage.querySelector("img"));
  /** @type {Record<string, string>} */
  const paths = {
    ghost:
      '<circle cx="32" cy="19" r="11"/><path d="M13 56v-9c0-15 8-23 19-23s19 8 19 23v9l-10-6-9 6-9-6z"/>',
    footprints:
      '<path d="M17 10c8-2 12 16 9 23l-10 2c-5-7-6-22 1-25zm-1 30 11-2 2 10-12 3zm25-17c8 2 7 20 2 25l-10-2c-3-8 0-25 8-23zm-9 28 11 2-2 10-12-3z"/>',
    presence:
      '<path d="M32 53C28 46 13 30 13 16C13-10 51-10 51 16C51 30 36 46 32 53M41 15a9 9 0 1 0-18 0a9 9 0 1 0 18 0" fill-rule="evenodd"/><rect x="24" y="59" width="16" height="2.5" rx="1.25" opacity=".35"/>'
  };
  const path = paths[appearance.markerStyle] ?? paths.presence;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="#e0c18a">${path}</svg>`;
  const src =
    appearance.markerStyle === "custom" && appearance.customMarkerImage
      ? appearance.customMarkerImage
      : `data:image/svg+xml,${encodeURIComponent(svg)}`;
  // Track the requested source separately: errors must not retry on every slider edit.
  if (image.dataset.requestedSrc !== src) {
    image.dataset.requestedSrc = src;
    image.onerror = () => {
      image.onerror = null;
      const fallback = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="#e0c18a">${paths.presence}</svg>`;
      image.src = `data:image/svg+xml,${encodeURIComponent(fallback)}`;
    };
    image.src = src;
  }
  image.style.opacity = String(appearance.opacity);
  image.style.filter = `grayscale(${appearance.grayscale})${appearance.outline ? ` drop-shadow(1px 0 0 ${appearance.outlineColor}) drop-shadow(-1px 0 0 ${appearance.outlineColor}) drop-shadow(0 1px 0 ${appearance.outlineColor}) drop-shadow(0 -1px 0 ${appearance.outlineColor})` : ""}`;
  image.style.transform = appearance.customMarkerRotate ? "rotate(35deg)" : "";
  const caption = /** @type {HTMLElement} */ (
    stage.querySelector(".rat-preview-caption")
  );
  const parts = [];
  if (get("showNames") !== false)
    parts.push(translate(host, "RAT.Settings.Preview.Target"));
  parts.push(translate(host, "RAT.LastPosition"));
  if (
    get("showRounds") !== false &&
    !encounterMemory(
      host.game.settings,
      host.game.system?.id,
      draft.daggerheartCombatMemory
    )
  )
    parts.push(
      translate(
        host,
        memoryTextKey(host.game.system?.id, "RAT.Settings.Preview.Rounds")
      )
    );
  caption.textContent = parts.join(" · ");
  caption.hidden = !appearance.labels || !parts.length;
  caption.classList.toggle(
    "rat-preview-caption-contrast",
    appearance.highContrast
  );
}
