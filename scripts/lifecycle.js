import { MODULE_ID } from "./constants.js";
import { MemoryStore } from "./core/memory-store.js";
import {
  registerSettings,
  migrateOpacity,
  migrateCaptions
} from "./settings.js";
import { ObservationTracker } from "./observation-tracker.js";
import { addTokenOverride } from "./foundry/token-config.js";
import { CombatMemoryPing } from "./combat-memory-ping.js";
import { localize } from "./localization.js";
import { createMemoryAPI } from "./memory-api.js";
import { SettingsPreview } from "./foundry/settings-preview.js";
import { RatControlPanel } from "./foundry/control-panel.js";

/** Installs client-local observation, rendering and owned hook lifecycle.
 * @param {import("../types/foundry.js").FoundryHost} host
 */
export function installModule(host) {
  const store = new MemoryStore();
  const tracker = new ObservationTracker(host, store);
  const settingsPreview = new SettingsPreview(host, values => {
    if (
      tracker.renderer.setPreview(values) &&
      tracker.context &&
      host.canvas?.ready
    )
      tracker.renderer.sync(store.records());
  });
  const memoryPing = new CombatMemoryPing(host, tracker);
  const memory = createMemoryAPI(host, tracker, memoryPing);
  const controlPanel = new RatControlPanel(host, memory.api, () =>
    tracker.clearMemory()
  );
  /** @type {Array<[string, number]>} */
  const hooks = [];
  const clearMemory = () => tracker.clearMemory();
  const resetContext = () => tracker.reset();
  let disposed = false;
  if (host.game.release.generation === 14)
    hooks.push([
      "getSceneControlButtons",
      host.Hooks.on("getSceneControlButtons", controls => {
        if (!disposed && host.game.release.generation === 14)
          controlPanel.addTool(controls);
      })
    ]);
  const checkpoint = () => tracker.checkpoint(true);
  const refreshAppearance = (key = "grayscale") => {
    if (["memoryRounds", "memoryMinutes"].includes(key)) {
      tracker.updatePolicy();
      return;
    }
    if (key === "combatOnly") {
      tracker.cache.clear();
      tracker.reset();
      return;
    }
    if (["labels", "showNames", "showRounds"].includes(key))
      tracker.renderer.refreshCaptions();
    else tracker.renderer.rebuild();
    tracker.schedule();
    tracker.notifyMemory(true);
  };

  hooks.push([
    "init",
    host.Hooks.once("init", () => {
      if (disposed) return;
      registerSettings(
        host.game.settings,
        refreshAppearance,
        host.foundry?.data?.fields?.ColorField
      );
      host.game.keybindings.register(MODULE_ID, "clearMemory", {
        name: "RAT.Clear.Name",
        hint: "RAT.Clear.Hint",
        editable: [],
        restricted: false,
        onDown: () => {
          clearMemory();
          return true;
        }
      });
    })
  ]);
  hooks.push([
    "ready",
    host.Hooks.once("ready", () => {
      if (disposed) return;
      if (host.game.release.generation !== 14) {
        host.ui.notifications.warn(localize(host, "RAT.Unsupported"));
        return;
      }
      tracker.updatePolicy();
      const module = host.game.modules.get(MODULE_ID);
      if (module)
        module.api = Object.freeze({
          stage: "observation",
          getDiagnostics: () => tracker.diagnostics(),
          startDiagnostics: () => tracker.setDiagnostics(true),
          stopDiagnostics: () => tracker.setDiagnostics(false),
          clearMemory,
          memory: memory.api
        });
      /** @param {string} event @param {(...args: any[]) => void} callback */
      const on = (event, callback) =>
        hooks.push([
          event,
          host.Hooks.on(event, (...args) => {
            try {
              callback(...args);
            } catch {
              tracker.fail();
            }
          })
        ]);
      on("canvasReady", resetContext);
      on("canvasTearDown", () => {
        controlPanel.close();
        tracker.suspend();
      });
      on("refreshToken", token => tracker.schedule(token));
      on("drawToken", token => tracker.schedule(token));
      on("updateToken", (document, changes) => {
        if (document.parent?.id !== host.canvas?.scene?.id) return;
        if (changes.hidden === true) {
          store.forget(document.id);
          tracker.renderer.forgetVisibility(document.id);
          if (tracker.context) tracker.renderer.sync(store.records());
        }
        if (document.object) tracker.schedule(document.object);
      });
      on("deleteToken", document => tracker.deleted(document));
      for (const event of [
        "sightRefresh",
        "initializeVisionSources",
        "updateActor",
        "updateCombat",
        "createCombat",
        "deleteCombat",
        "renderCombatTracker"
      ])
        on(event, () => tracker.schedule());
      on("controlToken", () => tracker.schedule());
      on("updateUser", user => {
        if (user.id === host.game.user.id) tracker.schedule();
      });
      on("renderTokenConfig", (app, element) =>
        addTokenOverride(host, app, element)
      );
      on("renderSettingsConfig", (app, element) =>
        settingsPreview.mount(app, element)
      );
      on("closeSettingsConfig", app => settingsPreview.unmount(app));
      on("renderCombatTracker", (app, element) =>
        memoryPing.mount(app, element)
      );
      on("closeCombatTracker", app => memoryPing.unmount(app));
      // Sidebar rendering can finish before ready while the canvas is loading.
      for (const app of [host.ui.combat, host.ui.combat?.popout])
        if (app?.rendered) memoryPing.mount(app, app.element);
      tracker.schedule();
      host.addEventListener?.("beforeunload", checkpoint);
      void migrateOpacity(host.game.settings).catch(() =>
        host.ui.notifications.warn(localize(host, "RAT.OpacityMigrationFailed"))
      );
      void migrateCaptions(host.game.settings).catch(() =>
        host.ui.notifications.warn(localize(host, "RAT.CaptionMigrationFailed"))
      );
    })
  ]);

  return Object.freeze({
    dispose() {
      disposed = true;
      for (const [event, id] of hooks) host.Hooks.off(event, id);
      hooks.length = 0;
      controlPanel.dispose();
      settingsPreview.dispose();
      tracker.suspend();
      memory.dispose();
      host.removeEventListener?.("beforeunload", checkpoint);
      memoryPing.dispose();
      const module = host.game.modules.get(MODULE_ID);
      if (module?.api?.clearMemory === clearMemory) delete module.api;
    }
  });
}
