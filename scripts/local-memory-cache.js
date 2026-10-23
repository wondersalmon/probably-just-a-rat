import { MODULE_ID } from "./constants.js";
import { localize } from "./localization.js";

const MAX_SIZE = 2_000_000;
export const isSavedImage = (/** @type {unknown} */ value) =>
  typeof value === "string" &&
  value.length <= 360_000 &&
  /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);

/** One bounded local checkpoint per world/user. Never writes server Documents or shares observations. */
export class LocalMemoryCache {
  /** @param {import("../types/foundry.js").FoundryHost} host @param {() => number} [now] */
  constructor(host, now = () => Date.now()) {
    this.host = host;
    this.now = now;
  }
  lastWrite = -Infinity;
  lastRetainedWrite = -Infinity;
  lastRetainedContext = "";
  warned = false;

  /** Retained scenes keep bounded checkpoints isolated by the complete vision context.
   * @param {string} context
   */
  readRetained(context) {
    try {
      const entry = this.retainedEntries()[context];
      const elapsedMs = this.now() - entry?.savedAt;
      if (
        !entry ||
        !Number.isFinite(entry.savedAt) ||
        !Number.isFinite(elapsedMs) ||
        elapsedMs < 0 ||
        entry.state?.contextKey !== context
      )
        return null;
      return {
        state: entry.state,
        images:
          entry.images && typeof entry.images === "object" ? entry.images : {},
        elapsedMs
      };
    } catch {
      return null;
    }
  }

  /** @returns {Record<string, {savedAt: number, state: import("../types/memory.js").MemoryCheckpoint, images: Record<string, string>}>} */
  retainedEntries() {
    const key = this.key();
    const raw = key && this.host.localStorage?.getItem(`${key}:retained`);
    if (!raw || raw.length > MAX_SIZE) return Object.create(null);
    const saved = JSON.parse(raw);
    return saved.version === 1 &&
      saved.entries &&
      typeof saved.entries === "object"
      ? saved.entries
      : Object.create(null);
  }

  /** @param {import("./core/memory-store.js").MemoryStore} store
   * @param {import("./foundry/marker-renderer.js").MarkerRenderer} renderer
   * @param {boolean} [force]
   */
  saveRetained(store, renderer, force = true) {
    const key = this.key();
    if (!key || !this.host.localStorage) return;
    const state = store.checkpoint();
    if (!state.contextKey) return;
    if (
      !force &&
      state.contextKey === this.lastRetainedContext &&
      this.now() - this.lastRetainedWrite < 500
    )
      return;
    try {
      const entries = this.retainedEntries();
      delete entries[state.contextKey];
      if (state.records.length) {
        /** @type {Record<string, string>} */
        const images = Object.create(null);
        let size = JSON.stringify(state).length;
        for (const record of state.records) {
          const image = renderer.savedImage(record.tokenId);
          if (image && size + image.length < MAX_SIZE - 2000) {
            images[record.tokenId] = image;
            size += image.length;
          }
        }
        entries[state.contextKey] = { savedAt: this.now(), state, images };
      }
      const ordered = Object.entries(entries)
        .reverse()
        .sort((a, b) => b[1].savedAt - a[1].savedAt);
      const bounded = Object.fromEntries(ordered.slice(0, 12));
      let data = JSON.stringify({ version: 1, entries: bounded });
      while (data.length > MAX_SIZE && Object.keys(bounded).length > 1) {
        delete bounded[Object.keys(bounded).at(-1) ?? ""];
        data = JSON.stringify({ version: 1, entries: bounded });
      }
      if (data.length > MAX_SIZE)
        throw new Error("Retained checkpoint too large");
      if (Object.keys(bounded).length)
        this.host.localStorage.setItem(`${key}:retained`, data);
      else this.host.localStorage.removeItem(`${key}:retained`);
      this.lastRetainedWrite = this.now();
      this.lastRetainedContext = state.contextKey;
    } catch {
      // Failed updates must not resurrect a manually forgotten position.
      this.clearRetained();
      this.warn();
    }
  }

  clearRetained() {
    try {
      const key = this.key();
      if (key) this.host.localStorage?.removeItem(`${key}:retained`);
    } catch {
      this.warn();
    }
  }

  /** @param {string} context */
  removeRetained(context) {
    try {
      const key = this.key();
      if (!key) return;
      const entries = this.retainedEntries();
      delete entries[context];
      if (Object.keys(entries).length)
        this.host.localStorage?.setItem(
          `${key}:retained`,
          JSON.stringify({ version: 1, entries })
        );
      else this.host.localStorage?.removeItem(`${key}:retained`);
    } catch {
      this.clearRetained();
    }
  }

  key() {
    const { world, user } = this.host.game;
    return world?.id && user?.id
      ? `${MODULE_ID}:memory:v1:${world.id}:${user.id}`
      : null;
  }
  warn() {
    if (this.warned) return;
    this.warned = true;
    this.host.ui.notifications.warn(
      localize(this.host, "RAT.CacheUnavailable")
    );
  }
  /** @param {string} context */
  read(context) {
    try {
      const key = this.key();
      if (!key) return null;
      const raw = this.host.localStorage?.getItem(key);
      if (!raw || raw.length > MAX_SIZE) return null;
      const saved = JSON.parse(raw);
      const elapsedMs = this.now() - saved.savedAt;
      if (
        saved.version !== 1 ||
        saved.state?.contextKey !== context ||
        !Number.isFinite(saved.savedAt) ||
        !Number.isFinite(elapsedMs) ||
        elapsedMs < 0
      ) {
        this.clear();
        return null;
      }
      return {
        state: /** @type {import("../types/memory.js").MemoryCheckpoint} */ (
          saved.state
        ),
        images: /** @type {Record<string, string>} */ (saved.images ?? {}),
        elapsedMs
      };
    } catch {
      this.clear();
      return null;
    }
  }
  /** @param {import("./core/memory-store.js").MemoryStore} store @param {import("./foundry/marker-renderer.js").MarkerRenderer} renderer @param {boolean} force */
  save(store, renderer, force) {
    try {
      const key = this.key();
      const storage = this.host.localStorage;
      if (!key || !storage || (!force && this.now() - this.lastWrite < 500))
        return;
      const state = store.checkpoint();
      if (!state.records.length) {
        this.clear();
        return;
      }
      /** @type {Record<string, string>} */
      const images = Object.create(null);
      let size = JSON.stringify(state).length;
      for (const record of state.records) {
        const image = renderer.savedImage(record.tokenId);
        if (image && size + image.length < MAX_SIZE - 1000) {
          images[record.tokenId] = image;
          size += image.length;
        }
      }
      const data = JSON.stringify({
        version: 1,
        savedAt: this.now(),
        state,
        images
      });
      if (data.length > MAX_SIZE) {
        this.clear();
        this.warn();
        return;
      }
      storage.setItem(key, data);
      this.lastWrite = this.now();
    } catch {
      // A stale checkpoint could otherwise resurrect an explicitly forgotten record.
      this.clear();
      this.warn();
    }
  }
  clear() {
    try {
      const key = this.key();
      if (key) this.host.localStorage?.removeItem(key);
    } catch {
      this.warn();
    }
  }
}
