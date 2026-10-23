import { MEMORY_DEFAULTS } from "../constants.js";
import { contextKey } from "./context.js";
import { freezeSnapshot } from "./snapshot.js";

/** Pure client-local state. Observation eligibility belongs to the native adapter. */
export class MemoryStore {
  /** @type {Map<string, Readonly<import("../../types/memory.js").MemoryRecord>>} */
  #records = new Map();
  /** @type {{ key: string, sceneId: string, levelId: string | null } | null} */
  #context = null;
  /** @type {import("../../types/memory.js").CombatStamp | null} */
  #combat = null;
  #roundHighWater = 0;
  #lastTime = 0;
  #policy;
  #now;

  /** @param {{ now?: () => number, policy?: Partial<import("../../types/memory.js").MemoryPolicy> }} [options] */
  constructor({ now = () => performance.now(), policy = {} } = {}) {
    this.#now = now;
    this.#policy = { ...MEMORY_DEFAULTS, ...policy };
    this.setPolicy(this.#policy);
  }

  get size() {
    return this.#records.size;
  }

  #time() {
    const now = this.#now();
    if (!Number.isFinite(now) || now < 0)
      throw new TypeError("Invalid monotonic clock.");
    this.#lastTime = Math.max(this.#lastTime, now);
    return this.#lastTime;
  }

  /** @param {import("../../types/memory.js").ObservationContext | null} context */
  setContext(context) {
    const next = context
      ? {
          key: contextKey(context),
          sceneId: context.sceneId,
          levelId: context.levelId
        }
      : null;
    if (next?.key !== this.#context?.key) this.clear();
    this.#context = next;
  }

  /** @param {Partial<import("../../types/memory.js").MemoryPolicy>} policy */
  setPolicy(policy) {
    const next = { ...this.#policy, ...policy };
    if (
      ![next.combatRounds, next.seconds].every(
        n => Number.isFinite(n) && n >= 0
      ) ||
      !Number.isInteger(next.combatRounds) ||
      typeof next.clearOnCombatEnd !== "boolean" ||
      typeof next.retainUntilRediscovered !== "boolean"
    )
      throw new TypeError("Invalid memory policy.");
    this.#policy = next;
    this.expire();
  }

  /**
   * Called only after confirmed visual detection in the current context.
   * @param {string} tokenId
   * @param {import("../../types/memory.js").SnapshotInput} input
   */
  observe(tokenId, input) {
    if (!this.#context || input.levelId !== this.#context.levelId) return false;
    if (!tokenId) throw new TypeError("Token ID is required.");
    const observedAt = this.#time();
    const previous = this.#records.get(tokenId);
    let movementAngle = 0;
    // Never infer a path across a visibility gap, reload or context change.
    if (previous?.state === "observed") {
      const dx = input.x - previous.snapshot.x;
      const dy = input.y - previous.snapshot.y;
      movementAngle =
        Math.hypot(dx, dy) > 0.01
          ? (Math.atan2(dy, dx) * 180) / Math.PI + 90
          : previous.snapshot.movementAngle;
    }
    const snapshot = freezeSnapshot(
      input,
      observedAt,
      this.#combat,
      movementAngle
    );
    this.#records.set(
      tokenId,
      Object.freeze({
        tokenId,
        sceneId: this.#context.sceneId,
        contextKey: this.#context.key,
        state: "observed",
        snapshot,
        expiresFrom: observedAt,
        combatAgeFrom: this.#combat ? this.#roundHighWater : null
      })
    );
    return true;
  }

  /** Loss of sight never accepts current coordinates or document data. @param {string} tokenId */
  loseSight(tokenId) {
    const record = this.#records.get(tokenId);
    if (record?.state === "observed") {
      this.#records.set(
        tokenId,
        Object.freeze({
          ...record,
          state: "remembered",
          // Event-driven observations may have been continuously visible while idle.
          expiresFrom: this.#time(),
          combatAgeFrom: this.#combat ? this.#roundHighWater : null
        })
      );
      this.expire();
    }
  }

  /** @param {string} tokenId */
  forget(tokenId) {
    return this.#records.delete(tokenId);
  }
  clear() {
    this.#records.clear();
  }

  /** Hidden policy is handled by the tracker; an unseen deletion retains memory. @param {string} tokenId */
  deleteToken(tokenId) {
    if (this.#records.get(tokenId)?.state === "observed") this.forget(tokenId);
  }

  /** Round high-water mark prevents rewinds extending or restoring memory.
   * @param {import("../../types/memory.js").CombatStamp | null} combat
   */
  setCombat(combat) {
    if (
      combat &&
      (!combat.id ||
        !Number.isInteger(combat.round) ||
        combat.round < 0 ||
        (combat.turn !== null &&
          (!Number.isInteger(combat.turn) || combat.turn < 0)))
    )
      throw new TypeError("Invalid combat stamp.");
    const previous = this.#combat;
    if (combat?.id !== previous?.id && !this.#policy.retainUntilRediscovered) {
      if (combat || this.#policy.clearOnCombatEnd) this.clear();
      else {
        this.expire();
        const expiresFrom = this.#time();
        for (const [id, record] of this.#records)
          this.#records.set(id, Object.freeze({ ...record, expiresFrom }));
      }
    }
    this.#roundHighWater = combat
      ? previous?.id === combat.id
        ? Math.max(this.#roundHighWater, combat.round)
        : combat.round
      : 0;
    this.#combat = combat ? { ...combat } : null;
    this.expire();
  }

  expire() {
    const now = this.#time();
    if (this.#policy.retainUntilRediscovered) return;
    for (const [id, record] of this.#records) {
      if (record.state !== "remembered") continue;
      const seenCombat = record.snapshot.combat;
      const expired =
        this.#combat && seenCombat?.id === this.#combat.id
          ? this.#policy.combatRounds > 0 &&
            this.#roundHighWater >=
              (record.combatAgeFrom ?? seenCombat.round) +
                this.#policy.combatRounds
          : this.#policy.seconds > 0 &&
            now - record.expiresFrom >= this.#policy.seconds * 1000;
      if (expired) this.#records.delete(id);
    }
  }

  /** @param {string} tokenId */
  get(tokenId) {
    this.expire();
    return this.#records.get(tokenId);
  }
  remembered() {
    return this.records().filter(record => record.state === "remembered");
  }
  records() {
    this.expire();
    return [...this.#records.values()];
  }

  /** Round age starts on loss of sight and never decreases after a combat rewind.
   * @param {Pick<import("../../types/memory.js").MemoryRecord, "snapshot"> & Partial<Pick<import("../../types/memory.js").MemoryRecord, "combatAgeFrom">>} record
   */
  roundsSinceLoss(record) {
    const combat = record.snapshot.combat;
    if (!combat || combat.id !== this.#combat?.id) return null;
    return Math.max(
      0,
      this.#roundHighWater - (record.combatAgeFrom ?? combat.round)
    );
  }

  /** Portable, allowlisted local checkpoint. Images are stored separately; URLs are never reloaded.
   * @returns {import("../../types/memory.js").MemoryCheckpoint}
   */
  checkpoint() {
    const now = this.#time();
    return {
      contextKey: this.#context?.key ?? "",
      combat: this.#combat ? { ...this.#combat } : null,
      roundHighWater: this.#roundHighWater,
      records: this.records()
        .sort((a, b) => b.snapshot.observedAt - a.snapshot.observedAt)
        .slice(0, 100)
        .map(record => ({
          tokenId: record.tokenId,
          snapshot: { ...record.snapshot, texture: null },
          ageMs:
            record.state === "observed"
              ? 0
              : Math.max(0, now - record.expiresFrom),
          seenAgeMs: Math.max(0, now - record.snapshot.observedAt),
          combatAgeFrom: record.combatAgeFrom
        }))
    };
  }

  /** Restore only into the exact current context; ordinary memory also requires the same combat.
   * Native observation must reconfirm visible tokens. Overland memory may span combats.
   * @param {import("../../types/memory.js").MemoryCheckpoint} saved @param {number} elapsedMs
   */
  restore(saved, elapsedMs) {
    if (
      !this.#context ||
      saved?.contextKey !== this.#context.key ||
      (!this.#policy.retainUntilRediscovered &&
        saved.combat?.id !== this.#combat?.id) ||
      !Array.isArray(saved.records) ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < 0 ||
      !Number.isInteger(saved.roundHighWater) ||
      saved.roundHighWater < 0
    )
      return;
    const now = this.#time();
    if (saved.combat?.id === this.#combat?.id)
      this.#roundHighWater = Math.max(
        this.#roundHighWater,
        saved.roundHighWater
      );
    for (const entry of saved.records.slice(0, 100)) {
      try {
        const combat = entry.snapshot?.combat;
        if (
          typeof entry.tokenId !== "string" ||
          !entry.tokenId ||
          ![entry.ageMs, entry.seenAgeMs].every(
            n => Number.isFinite(n) && n >= 0
          ) ||
          entry.snapshot.levelId !== this.#context.levelId ||
          (!this.#policy.retainUntilRediscovered &&
            combat?.id !== saved.combat?.id) ||
          (combat &&
            (typeof combat.id !== "string" ||
              !combat.id ||
              !Number.isInteger(combat.round) ||
              combat.round < 0 ||
              (combat.turn !== null &&
                (!Number.isInteger(combat.turn) || combat.turn < 0)))) ||
          (entry.combatAgeFrom !== null &&
            (!Number.isInteger(entry.combatAgeFrom) || entry.combatAgeFrom < 0))
        )
          continue;
        const snapshot = freezeSnapshot(
          { ...entry.snapshot, texture: null },
          now - entry.seenAgeMs - elapsedMs,
          combat,
          entry.snapshot.movementAngle ?? 0
        );
        this.#records.set(
          entry.tokenId,
          Object.freeze({
            tokenId: entry.tokenId,
            sceneId: this.#context.sceneId,
            contextKey: this.#context.key,
            state: "remembered",
            snapshot,
            expiresFrom: now - entry.ageMs - elapsedMs,
            combatAgeFrom: entry.combatAgeFrom
          })
        );
      } catch {
        /* A corrupt entry must not prevent restoring other valid memories. */
      }
    }
    this.expire();
  }
}
