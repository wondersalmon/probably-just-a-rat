import { MODULE_ID } from "../constants.js";
import { normalizeOutlineColor } from "../appearance.js";
import {
  organizeSettings,
  translateSettings,
  updateCaptionControls,
  updateSceneMemoryLink,
  updateSettingsSample,
  validateMemoryInputs
} from "./settings-layout.js";

/** Preview native settings locally; only Foundry's form submission persists values. */
export class SettingsPreview {
  /** @param {import("../../types/foundry.js").FoundryHost} host
   * @param {(values: Partial<{markerStyle: string, customMarkerImage: string, opacity: number, grayscale: number, outline: boolean, outlineColor: string, labels: string, captionStyle: string, customMarkerRotate: boolean, showNames: boolean, showRounds: boolean}>) => void} apply
   */
  constructor(host, apply) {
    this.host = host;
    this.apply = apply;
  }
  /** @type {Map<any, {root: HTMLElement, listener: (event: Event) => void, values: Partial<{markerStyle: string, customMarkerImage: string, opacity: number, grayscale: number, outline: boolean, outlineColor: string, labels: string, captionStyle: string, customMarkerRotate: boolean, showNames: boolean, showRounds: boolean}>}>} */
  bindings = new Map();
  /** @type {any} */
  ticker = null;
  flush = () => {
    this.ticker = null;
    const bindings = [...this.bindings.values()];
    this.apply(bindings.at(-1)?.values ?? {});
  };
  schedule() {
    if (this.ticker) return;
    const ticker = this.host.canvas?.app?.ticker;
    if (!ticker) return this.flush();
    this.ticker = ticker;
    ticker.addOnce(this.flush, this, this.host.PIXI.UPDATE_PRIORITY.NORMAL);
  }
  /** @param {HTMLElement} root */
  updateColorVisibility(root) {
    const color = root.querySelector(`[name="${MODULE_ID}.outlineColor"]`);
    const group = /** @type {HTMLElement | null | undefined} */ (
      color?.closest?.(".form-group")
    );
    if (!group) return;
    const toggle = /** @type {HTMLInputElement | null} */ (
      root.querySelector(`input[name="${MODULE_ID}.outline"]`)
    );
    const enabled =
      toggle?.checked ??
      Boolean(this.host.game.settings.get(MODULE_ID, "outline"));
    group.hidden = false;
    group.style.display = "";
    group.classList?.toggle("rat-outline-inactive", !enabled);
  }
  /** @param {HTMLElement} root */
  updateImageVisibility(root) {
    const field = root.querySelector(
      '[name="' + MODULE_ID + '.customMarkerImage"]'
    );
    const group = /** @type {HTMLElement | null | undefined} */ (
      field?.closest?.(".form-group")
    );
    const style = /** @type {HTMLSelectElement | null} */ (
      root.querySelector('select[name="' + MODULE_ID + '.markerStyle"]')
    );
    const enabled =
      (style?.value ??
        this.host.game.settings.get(MODULE_ID, "markerStyle")) === "custom";
    if (!group) return;
    group.hidden = !enabled;
    group.style.display = enabled ? "" : "none";
  }
  /** @param {any} app @param {HTMLElement} root */
  mount(app, root) {
    if (!root?.addEventListener) return;
    const previous = this.bindings.get(app);
    if (previous) this.detach(previous);
    const values = previous?.values ?? {};
    // Keep an unsaved preview and its controls consistent after a native rerender.
    for (const [key, value] of Object.entries(values)) {
      const field = root.querySelector(`[name="${MODULE_ID}.${key}"]`);
      if (field) {
        const input = /** @type {HTMLInputElement} */ (field);
        if (typeof value === "boolean") input.checked = value;
        else input.value = String(value);
      }
    }
    translateSettings(this.host, root);
    organizeSettings(
      this.host,
      root,
      previous?.root.dataset?.ratSettingsSection
    );
    validateMemoryInputs(this.host, root);
    updateCaptionControls(this.host, root, values);
    this.updateColorVisibility(root);
    this.updateImageVisibility(root);
    updateSettingsSample(this.host, root, values);
    /** @param {Event} event */
    const listener = event => {
      validateMemoryInputs(this.host, root);
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (!target?.closest) return;
      const field = target.closest(
        "range-picker[name], color-picker[name], file-picker[name], input[name], select[name]"
      );
      const name = field?.getAttribute("name");
      const key =
        name === `${MODULE_ID}.markerStyle`
          ? "markerStyle"
          : name === `${MODULE_ID}.customMarkerImage`
            ? "customMarkerImage"
            : name === `${MODULE_ID}.opacity`
              ? "opacity"
              : name === `${MODULE_ID}.grayscale`
                ? "grayscale"
                : name === `${MODULE_ID}.outline`
                  ? "outline"
                  : name === `${MODULE_ID}.outlineColor`
                    ? "outlineColor"
                    : name === `${MODULE_ID}.labels`
                      ? "labels"
                      : name === `${MODULE_ID}.customMarkerRotate`
                        ? "customMarkerRotate"
                        : name === `${MODULE_ID}.showNames`
                          ? "showNames"
                          : name === `${MODULE_ID}.showRounds`
                            ? "showRounds"
                            : null;
      if (name === `${MODULE_ID}.captionStyle`) {
        if (
          !this.host.game.user.isGM ||
          !["off", "standard", "contrast"].includes(target.value)
        )
          return;
        values.captionStyle = target.value;
        updateCaptionControls(this.host, root, values);
        updateSettingsSample(this.host, root, values);
        const binding = this.bindings.get(app);
        if (binding) {
          this.bindings.delete(app);
          this.bindings.set(app, binding);
        }
        this.schedule();
        return;
      }
      if (!key) return;
      if (["showNames", "showRounds", "customMarkerRotate"].includes(key)) {
        if (!this.host.game.user.isGM) return;
        values[
          /** @type {"customMarkerRotate" | "showNames" | "showRounds"} */ (key)
        ] = Boolean(target.checked);
      } else if (key === "labels") {
        if (
          this.host.game.user.isGM ||
          this.host.game.settings.get(MODULE_ID, "captionStyle") === "off" ||
          !["standard", "contrast"].includes(target.value)
        )
          return;
        values.labels = target.value;
      } else if (key === "markerStyle") {
        if (!this.host.game.user.isGM) return;
        if (
          !["ghost", "footprints", "presence", "custom"].includes(target.value)
        )
          return;
        if (values.markerStyle === target.value) return;
        values.markerStyle = target.value;
        this.updateImageVisibility(root);
      } else if (key === "customMarkerImage") {
        if (!this.host.game.user.isGM) return;
        const path = String(
          target.tagName === "INPUT"
            ? target.value
            : /** @type {HTMLInputElement} */ (field).value
        ).trim();
        if (values.customMarkerImage === path) return;
        values.customMarkerImage = path;
      } else if (key === "outline") {
        this.updateColorVisibility(root);
        const checked = Boolean(target.checked);
        if (values.outline === checked) return;
        values.outline = checked;
      } else if (key === "outlineColor") {
        const raw =
          target.tagName === "INPUT"
            ? target.value
            : /** @type {HTMLInputElement} */ (field).value;
        if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return;
        const color = normalizeOutlineColor(raw);
        if (values.outlineColor === color) return;
        values.outlineColor = color;
      } else {
        // During typing the number input has not committed to its range-picker.
        const raw =
          target.tagName === "INPUT"
            ? target.value
            : /** @type {HTMLInputElement} */ (field).value;
        if (raw === "" || !Number.isFinite(Number(raw))) return;
        const value = Math.min(
          key === "opacity" ? 80 : 100,
          Math.max(key === "opacity" ? 30 : 0, Number(raw))
        );
        if (values[key] === value) return;
        values[/** @type {"opacity" | "grayscale"} */ (key)] = value;
      }
      updateSettingsSample(this.host, root, values);
      // The most recently edited settings window owns the local preview.
      const binding = this.bindings.get(app);
      if (binding) {
        this.bindings.delete(app);
        this.bindings.set(app, binding);
      }
      this.schedule();
    };
    root.addEventListener("input", listener);
    root.addEventListener("change", listener);
    this.bindings.set(app, { root, listener, values });
  }
  refreshCaptionPolicy() {
    for (const { root, values } of this.bindings.values()) {
      updateCaptionControls(this.host, root, values);
      updateSettingsSample(this.host, root, values);
    }
  }
  refreshSceneLink() {
    for (const { root } of this.bindings.values())
      updateSceneMemoryLink(this.host, root);
  }
  refreshLanguage() {
    for (const { root, values } of this.bindings.values()) {
      translateSettings(this.host, root);
      updateCaptionControls(this.host, root, values);
      validateMemoryInputs(this.host, root);
      updateSettingsSample(this.host, root, values);
    }
  }
  /** @param {{root: HTMLElement, listener: (event: Event) => void}} binding */
  detach(binding) {
    binding.root.removeEventListener("input", binding.listener);
    binding.root.removeEventListener("change", binding.listener);
  }
  /** @param {any} app */
  unmount(app) {
    const binding = this.bindings.get(app);
    if (!binding) return;
    this.detach(binding);
    this.bindings.delete(app);
    // Closing after Save reads the new stored settings; cancelling reads the old ones.
    this.schedule();
  }
  dispose() {
    for (const binding of this.bindings.values()) this.detach(binding);
    this.bindings.clear();
    this.ticker?.remove(this.flush, this);
    this.ticker = null;
    this.apply({});
  }
}
