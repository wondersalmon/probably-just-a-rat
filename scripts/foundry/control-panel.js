import { MODULE_ID } from "../constants.js";
import { localize, format } from "../localization.js";
import { openCurrentSceneMemorySettings } from "./scene-config.js";

/** A native standalone view of the same permission-checked API used by Adventurer HUD. */
export class RatControlPanel {
  /** @param {import("../../types/foundry.js").FoundryHost} host
   * @param {ReturnType<typeof import("../memory-api.js").createMemoryAPI>["api"]} api
   * @param {() => void} clear
   */
  constructor(host, api, clear) {
    this.host = host;
    this.api = api;
    this.clear = clear;
  }
  /** @type {any} */
  window = null;
  /** @type {(() => void) | null} */
  unsubscribe = null;
  /** @type {Set<string>} */
  pending = new Set();
  open = false;
  disposed = false;
  clearing = false;
  toggling = false;

  /** @param {any} controls */
  addTool(controls) {
    const tokens = controls.tokens;
    if (!tokens || this.disposed) return;
    tokens.tools ??= {};
    tokens.tools[MODULE_ID] = {
      name: MODULE_ID,
      title: localize(this.host, "RAT.Controls.Title"),
      icon: "fa-solid fa-mouse-field",
      order:
        Math.max(
          0,
          ...Object.values(tokens.tools).map(
            tool => Number(/** @type {any} */ (tool).order) || 0
          )
        ) + 1,
      button: true,
      visible: true,
      onChange: () => {
        void this.toggle();
      }
    };
  }

  createWindow() {
    const Base = this.host.foundry?.applications?.api?.ApplicationV2;
    if (!Base) throw new Error("ApplicationV2 unavailable");
    const panel = this;
    return new (class RatMemoryControls extends Base {
      static DEFAULT_OPTIONS = {
        id: "rat-memory-controls",
        classes: ["rat-memory-controls"],
        window: {
          title: localize(panel.host, "RAT.Controls.Title"),
          icon: "fa-solid fa-mouse-field",
          resizable: false
        },
        position: { width: 310, height: "auto", left: 85, top: 100 }
      };
      async _renderHTML() {
        return panel.build();
      }
      /** @param {HTMLElement} result @param {HTMLElement} content */
      _replaceHTML(result, content) {
        const scroll =
          content.querySelector(".rat-controls-list")?.scrollTop ?? 0;
        const active = /** @type {HTMLElement | null} */ (
          content.ownerDocument.activeElement
        );
        const action = content.contains(active)
          ? active?.dataset.ratAction
          : null;
        const id = active
          ?.closest("[data-memory-id]")
          ?.getAttribute("data-memory-id");
        content.replaceChildren(result);
        const list = content.querySelector(".rat-controls-list");
        if (list) list.scrollTop = scroll;
        if (action) {
          const next = Array.from(
            content.querySelectorAll("button[data-rat-action]")
          ).find(
            button =>
              button.getAttribute("data-rat-action") === action &&
              button
                .closest("[data-memory-id]")
                ?.getAttribute("data-memory-id") === id
          );
          /** @type {HTMLElement | undefined} */ (next)?.focus();
        }
      }
      /** @param {any} options */
      _onClose(options) {
        super._onClose(options);
        panel.closed();
      }
    })();
  }

  async toggle() {
    if (this.disposed || this.toggling) return;
    this.toggling = true;
    try {
      if (this.open) {
        this.closed();
        await this.window?.close();
        return;
      }
      this.window ??= this.createWindow();
      this.open = true;
      this.unsubscribe = this.api.subscribe(() => this.refresh());
      await this.window.render({ force: true });
      if (!this.open || this.disposed) await this.window.close();
      else this.window.bringToFront();
    } catch {
      this.closed();
      this.warn();
    } finally {
      this.toggling = false;
    }
  }

  refresh() {
    if (!this.open || this.disposed) return;
    void Promise.resolve(this.window.render({ force: true })).catch(() =>
      this.warn()
    );
  }

  /** @param {string} key @param {string} action @param {string} icon */
  button(key, action, icon) {
    const button = this.host.document.createElement("button");
    button.type = "button";
    button.className = "rat-controls-button";
    button.dataset.ratAction = action;
    button.title = localize(this.host, key);
    button.setAttribute("aria-label", button.title);
    const glyph = this.host.document.createElement("i");
    glyph.className = `fa-solid ${icon}`;
    glyph.setAttribute("aria-hidden", "true");
    button.append(glyph);
    return button;
  }

  build() {
    const doc = this.host.document;
    const records = this.api.list();
    const root = doc.createElement("section");
    root.className = "rat-controls-body";
    const heading = root.appendChild(doc.createElement("div"));
    heading.className = "rat-controls-heading";
    const count = heading.appendChild(doc.createElement("strong"));
    count.textContent = format(this.host, "RAT.Controls.Count", {
      count: records.length
    });
    const clear = this.button("RAT.Controls.Clear", "clear", "fa-trash-can");
    clear.disabled = !records.length || this.clearing || this.pending.size > 0;
    const settings = this.button(
      "RAT.Controls.Settings",
      "settings",
      "fa-gear"
    );
    settings.disabled = !this.host.game.settings.sheet;
    heading.append(clear);
    if (this.host.game.user.isGM) {
      const visibility = this.button(
        "RAT.Controls.SceneVisibility",
        "scene-visibility",
        "fa-eye"
      );
      visibility.disabled =
        !this.host.canvas?.ready || !this.host.canvas.scene?.isOwner;
      heading.append(visibility);
    }
    heading.append(settings);
    const list = root.appendChild(doc.createElement("div"));
    list.className = "rat-controls-list";
    for (const record of records) {
      const row = list.appendChild(doc.createElement("div"));
      row.className = "rat-controls-record";
      row.dataset.memoryId = record.id;
      const description = row.appendChild(doc.createElement("div"));
      description.className = "rat-controls-description";
      const name = description.appendChild(doc.createElement("strong"));
      name.textContent = name.title = record.name;
      const detail = description.appendChild(doc.createElement("small"));
      detail.textContent = detail.title = record.label;
      const actions = row.appendChild(doc.createElement("div"));
      actions.className = "rat-controls-actions";
      for (const [key, action, icon] of [
        ["RAT.Controls.Ping", "ping", "fa-tower-broadcast"],
        ["RAT.Controls.Center", "center", "fa-location-crosshairs"],
        ["RAT.Controls.Forget", "forget", "fa-eraser"]
      ]) {
        const button = this.button(key, action, icon);
        button.disabled =
          this.clearing ||
          this.pending.has(record.id) ||
          (action === "ping" &&
            !this.host.game.user.hasPermission?.("PING_CANVAS"));
        actions.append(button);
      }
    }
    if (!records.length) {
      const empty = list.appendChild(doc.createElement("p"));
      empty.className = "rat-controls-empty";
      empty.setAttribute("role", "status");
      empty.textContent = localize(this.host, "RAT.Controls.Empty");
    }
    root.addEventListener("click", event => {
      void this.onAction(event);
    });
    return root;
  }

  /** @param {MouseEvent} event */
  async onAction(event) {
    const button = /** @type {HTMLButtonElement | null} */ (
      /** @type {HTMLElement} */ (event.target)?.closest?.(
        "button[data-rat-action]"
      )
    );
    if (!this.open || this.disposed || !button || button.disabled) return;
    event.stopPropagation();
    const action = button.dataset.ratAction;
    const id = button
      .closest("[data-memory-id]")
      ?.getAttribute("data-memory-id");
    try {
      if (action === "scene-visibility") {
        button.disabled = true;
        try {
          if (!(await openCurrentSceneMemorySettings(this.host)))
            this.host.ui.notifications.warn(
              localize(this.host, "RAT.Settings.SceneMemory.Unavailable")
            );
        } finally {
          this.refresh();
        }
      } else if (action === "settings") {
        const sheet = this.host.game.settings.sheet;
        await sheet.render({ force: true });
        if (!this.open || this.disposed) return;
        sheet.search("");
        sheet.changeTab(MODULE_ID, "categories");
        sheet.bringToFront();
      } else if (action === "clear") {
        if (this.clearing || this.pending.size) return;
        this.clearing = true;
        try {
          this.clear();
        } finally {
          this.clearing = false;
          this.refresh();
        }
      } else if (id && ["ping", "center", "forget"].includes(action ?? "")) {
        if (this.clearing || this.pending.has(id)) return;
        this.pending.add(id);
        try {
          if (action === "ping") this.api.ping(id, event);
          else if (action === "center") {
            this.refresh();
            await this.api.center(id);
          } else this.api.forget(id);
        } finally {
          this.pending.delete(id);
          this.refresh();
        }
      }
    } catch {
      this.warn();
    }
  }

  warn() {
    this.host.ui.notifications.warn(
      localize(this.host, "RAT.Controls.ActionFailed")
    );
  }
  close() {
    this.closed();
    void Promise.resolve(this.window?.close()).catch(() => {
      if (!this.disposed) this.warn();
    });
  }
  closed() {
    this.open = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
  dispose() {
    this.disposed = true;
    this.closed();
    void Promise.resolve(this.window?.close()).catch(() => {});
    const tools = this.host.ui.controls?.controls?.tokens?.tools;
    if (tools) {
      delete tools[MODULE_ID];
      if (this.host.ui.controls.rendered)
        void Promise.resolve(
          this.host.ui.controls.render({ force: true })
        ).catch(() => {});
    }
  }
}
