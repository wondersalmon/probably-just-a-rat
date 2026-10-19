import { MODULE_ID } from "./constants.js";
import { contextKey } from "./core/context.js";
import { localize } from "./localization.js";

/** Capture only the native tracker ping action. No method wrapping, hidden center reads or automatic broadcasts. */
export class CombatMemoryPing {
  /** @param {import("../types/foundry.js").FoundryHost} host @param {import("./observation-tracker.js").ObservationTracker} tracker */
  constructor(host, tracker) {
    this.host = host;
    this.tracker = tracker;
  }
  /** @type {Map<any, {root: HTMLElement, listener: EventListener}>} */
  bindings = new Map();
  /** @param {any} app @param {HTMLElement} root */
  mount(app, root) {
    this.unmount(app);
    if (!root?.addEventListener) return;
    const listener = (/** @type {Event} */ event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!target?.closest?.('[data-action="pingCombatant"]')) return;
      const id = target
        .closest("[data-combatant-id]")
        ?.getAttribute("data-combatant-id");
      const combatant = app.viewed?.combatants.get(id);
      if (!combatant) return;
      try {
        this.handle(/** @type {MouseEvent} */ (event), combatant);
      } catch {
        this.warn();
      }
    };
    root.addEventListener("click", listener, true);
    this.bindings.set(app, { root, listener });
  }
  /** @param {MouseEvent} event @param {any} combatant */
  handle(event, combatant) {
    if (combatant.sceneId !== this.host.canvas.scene?.id) return false;
    return this.ping(combatant.tokenId, event);
  }
  /** Ping only an existing remembered record from the native combat tracker.
   * @param {string} tokenId @param {MouseEvent} event
   */
  ping(tokenId, event) {
    const { canvas, game } = this.host;
    if (!canvas.ready || !game.user.hasPermission?.("PING_CANVAS"))
      return false;
    const context = this.tracker.adapter.context();
    if (!context || contextKey(context) !== this.tracker.context) return false;
    // Combat hooks batch until the next frame; clicks must use the current round.
    this.tracker.store.setCombat(this.tracker.adapter.combat());
    const record = this.tracker.store.get(tokenId);
    if (record?.state !== "remembered" || record.sceneId !== canvas.scene?.id)
      return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const s = record.snapshot;
    const position = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const audience = game.settings.get(MODULE_ID, "sharePings");
    const shared = audience === true || audience === "true";
    try {
      const action = shared
        ? canvas.ping(position)
        : canvas.controls.handlePing(game.user, position, {
            scene: canvas.scene.id,
            ...this.localOptions(event)
          });
      void Promise.resolve(action).catch(() => this.warn());
    } catch {
      this.warn();
    }
    return true;
  }
  /** Match native Canvas.ping ordering: SHIFT takes precedence over ALT.
   * Shared pings delegate entirely to Canvas.ping instead.
   * @param {MouseEvent} event
   */
  localOptions(event) {
    const { game, canvas, CONFIG } = this.host;
    const shift =
      game.keyboard?.isModifierActive("SHIFT") ?? Boolean(event.shiftKey);
    const alt = game.keyboard?.isModifierActive("ALT") ?? Boolean(event.altKey);
    const types = CONFIG.Canvas.pings.types;
    return {
      style: shift ? types.PULL : alt ? types.ALERT : types.PULSE,
      pull: shift,
      zoom: canvas.stage.scale.x
    };
  }
  warn() {
    this.host.ui.notifications.warn(localize(this.host, "RAT.PingFailed"));
  }
  /** @param {any} app */
  unmount(app) {
    const binding = this.bindings.get(app);
    binding?.root.removeEventListener("click", binding.listener, true);
    this.bindings.delete(app);
  }
  dispose() {
    for (const app of this.bindings.keys()) this.unmount(app);
  }
}
