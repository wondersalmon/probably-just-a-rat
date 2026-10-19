import { MODULE_ID } from "./constants.js";
import { contextKey } from "./core/context.js";
import { localize, snapshotName } from "./localization.js";

/** Prepared client-local records only. Handles expire with their original snapshot/context.
 * @param {import('../types/foundry.js').FoundryHost} host
 * @param {import('./observation-tracker.js').ObservationTracker} tracker
 * @param {import('./combat-memory-ping.js').CombatMemoryPing} pings
 */
export function createMemoryAPI(host, tracker, pings) {
  let serial = 0;
  let disposed = false;
  const identities = new WeakMap();
  /** @type {Map<string, Readonly<import('../types/memory.js').MemoryRecord>>} */
  let handles = new Map();
  const current = () => {
    if (disposed || tracker.failed) return false;
    const context = tracker.adapter.context();
    if (!context || contextKey(context) !== tracker.context) return false;
    tracker.store.setCombat(tracker.adapter.combat());
    return true;
  };
  const list = () => {
    if (!current()) {
      handles.clear();
      return [];
    }
    const next = new Map();
    const records = tracker.store.remembered().map(record => {
      let id = identities.get(record.snapshot);
      if (!id) identities.set(record.snapshot, (id = `memory-${++serial}`));
      next.set(id, record);
      return Object.freeze({
        id,
        name: host.game.settings.get(MODULE_ID, "showNames")
          ? snapshotName(host, record.snapshot.name)
          : localize(host, "RAT.Unknown"),
        label: tracker.renderer.label(record)
      });
    });
    handles = next;
    return Object.freeze(records);
  };
  /** @param {string} id */
  const resolve = id => {
    if (!current()) return null;
    const saved = handles.get(id);
    const record = saved && tracker.store.get(saved.tokenId);
    return record?.state === "remembered" &&
      record.contextKey === tracker.context &&
      record.snapshot === saved?.snapshot
      ? record
      : null;
  };
  const api = Object.freeze({
    version: 1,
    list,
    /** @param {string} id @param {MouseEvent} event */
    ping(id, event) {
      const record = resolve(id);
      return record ? pings.ping(record.tokenId, event) : false;
    },
    /** @param {string} id */
    async center(id) {
      const record = resolve(id);
      if (!record) return false;
      const s = record.snapshot;
      await host.canvas.animatePan({
        x: s.x + s.width / 2,
        y: s.y + s.height / 2
      });
      return true;
    },
    /** @param {string} id */
    forget(id) {
      const record = resolve(id);
      if (!record) return false;
      tracker.forget(record.tokenId);
      return true;
    },
    /** @param {() => void} listener */
    subscribe(listener) {
      if (disposed) return () => {};
      tracker.memoryListeners.add(listener);
      return () => tracker.memoryListeners.delete(listener);
    }
  });
  return {
    api,
    dispose() {
      disposed = true;
      handles.clear();
      tracker.notifyMemory(true);
      tracker.memoryListeners.clear();
    }
  };
}
