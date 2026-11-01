import { VisibilityAdapter } from "./foundry/visibility-adapter.js";
import { MarkerRenderer } from "./foundry/marker-renderer.js";
import { contextKey } from "./core/context.js";
import { LocalMemoryCache, isSavedImage } from "./local-memory-cache.js";
import { localize } from "./localization.js";
import { MODULE_ID } from "./constants.js";
import { memoryPolicy, sceneRetainsMemory } from "./settings.js";
import { memoryRules } from "./memory-status.js";

export class ObservationTracker {
  /** @param {import("../types/foundry.js").FoundryHost} host @param {import("./core/memory-store.js").MemoryStore} store */
  constructor(host, store) {
    this.host = host;
    this.store = store;
    this.adapter = new VisibilityAdapter(host);
    this.renderer = new MarkerRenderer(host, store, () => this.schedule());
    this.cache = new LocalMemoryCache(host);
  }
  /** @type {Set<any>} */
  pending = new Set();
  /** Native animations need observation on every rendered frame, even when refresh hooks coalesce.
   * @type {Set<any>}
   */
  animating = new Set();
  /** @type {any} */
  ticker = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  timer = null;
  full = false;
  failed = false;
  diagnosticsEnabled = false;
  context = "";
  restoreAttempted = false;
  retainedContext = false;
  lastRemembered = 0;
  memorySignature = "";
  /** @type {Set<() => void>} */
  memoryListeners = new Set();
  /** Bounded opt-in diagnostics: rejected samples never include current coordinates or image/name data.
   * @type {Array<{tokenId: string, reason: string, animated: boolean, lastObserved: {x: number, y: number} | null}>}
   */
  samples = [];

  /** Native refreshToken fires after both visibility and position render flags have applied.
   * Preserve a confirmed visible step now; the queued pass may run after later refreshes.
   * @param {any} token @param {{refreshPosition?: boolean}} [flags]
   */
  refreshed(token, flags) {
    this.schedule(token);
    if (
      this.failed ||
      !flags?.refreshPosition ||
      !this.context ||
      token.destroyed ||
      token.isPreview
    )
      return;
    const context = this.adapter.context();
    if (
      !context ||
      contextKey(context) !== this.context ||
      token.document.parent?.id !== context.sceneId
    )
      return;
    this.store.setCombat(this.adapter.combat());
    if (!this.adapter.candidate(token)) {
      this.store.forget(token.document.id);
      return;
    }
    if (!this.adapter.visible(token, context)) {
      // Preserve visibility gaps even if several refreshes precede the queued pass.
      this.store.loseSight(token.document.id);
      return;
    }
    const snapshot = this.adapter.snapshot(token);
    this.store.observe(token.document.id, snapshot);
    this.renderer.capture(token.document.id, token, snapshot);
  }

  flush = () => {
    if (this.failed) return;
    try {
      const context = this.adapter.context();
      if (!context) {
        if (
          this.host.game.settings.get(MODULE_ID, "combatOnly") &&
          !this.adapter.combat()
        )
          this.cache.clear();
        this.suspend();
        return;
      }
      const key = contextKey(context);
      if (key !== this.context) {
        if (this.context) {
          if (this.retainedContext)
            this.cache.saveRetained(this.store, this.renderer);
          else this.cache.clear();
        }
        this.renderer.clear();
        this.context = key;
        this.restoreAttempted = false;
        this.full = true;
      }
      this.retainedContext = sceneRetainsMemory(this.host.canvas.scene);
      this.store.setContext(context);
      this.store.setPolicy(
        memoryPolicy(
          this.host.game.settings,
          this.host.canvas.scene,
          this.host.game.system?.id
        )
      );
      this.store.setCombat(this.adapter.combat());
      const saved = !this.restoreAttempted
        ? this.retainedContext
          ? (this.cache.readRetained(key) ?? this.cache.read(key))
          : this.cache.read(key)
        : null;
      if (this.retainedContext && !this.restoreAttempted) this.cache.clear();
      this.restoreAttempted = true;
      if (saved) this.store.restore(saved.state, saved.elapsedMs);
      // Moving an observer can change every target's visibility without refreshing each target.
      const movingSource = context.sources.some(source =>
        this.animating.has(source.object)
      );
      const tokens =
        this.full || movingSource
          ? this.host.canvas.tokens.placeables
          : [...new Set([...this.pending, ...this.animating])];
      this.full = false;
      this.pending.clear();
      for (const token of tokens) {
        if (
          token.destroyed ||
          token.isPreview ||
          token.document.parent?.id !== context.sceneId
        )
          continue;
        const id = token.document.id;
        // Hidden may retain only an existing snapshot, never sample the hidden token.
        if (token.document.hidden) {
          this.renderer.trackVisibility(token, false);
          if (
            (sceneRetainsMemory(this.host.canvas.scene) ||
              this.host.game.settings.get(MODULE_ID, "rememberHidden")) &&
            this.adapter.candidate(token)
          )
            this.store.loseSight(id);
          else this.store.forget(id);
          continue;
        }
        const visible = this.adapter.visible(token, context);
        this.renderer.trackVisibility(token, visible);
        if (!this.adapter.candidate(token)) {
          this.store.forget(id);
          continue;
        }
        if (visible) {
          const snapshot = this.adapter.snapshot(token);
          this.store.observe(id, snapshot);
          this.renderer.capture(id, token, snapshot);
        } else this.store.loseSight(id);
        if (this.diagnosticsEnabled) {
          const last = this.store.get(id)?.snapshot;
          this.samples.push({
            tokenId: id,
            reason: this.adapter.lastVisibilityReason,
            animated: Boolean(token.animationContexts?.size),
            lastObserved: last ? { x: last.x, y: last.y } : null
          });
          if (this.samples.length > 64) this.samples.shift();
        } else this.samples.length = 0;
      }
      if (saved) void this.restoreImages(saved.images, key);
      this.renderer.sync(this.store.records());
      this.notifyMemory();
      const count = this.store.remembered().length;
      if (count !== this.lastRemembered && this.diagnosticsEnabled)
        console.debug("Probably Just a Rat | local memory", {
          remembered: count
        });
      this.lastRemembered = count;
      this.ensureTimer();
      this.checkpoint();
      for (const token of this.animating)
        if (token.destroyed || !token.animationContexts?.size)
          this.animating.delete(token);
      if (!this.animating.size && !this.pending.size && !this.full) {
        this.ticker?.remove(this.flush, this);
        this.ticker = null;
      }
    } catch {
      this.fail();
    }
  };

  /** Batch after Token animation (OBJECTS+1), Token render flags (OBJECTS), and perception (NORMAL+2).
   * Retain this callback only while native token animations are running.
   * @param {any} [token]
   */
  schedule(token) {
    if (this.failed || !this.host.canvas?.ready) {
      this.notifyMemory();
      return;
    }
    if (token) {
      this.pending.add(token);
      if (token.animationContexts?.size) this.animating.add(token);
    } else this.full = true;
    if (this.ticker) return;
    if (!this.host.canvas.app?.ticker?.add) {
      this.fail();
      return;
    }
    this.ticker = this.host.canvas.app.ticker;
    this.ticker.add(
      this.flush,
      this,
      this.host.PIXI.UPDATE_PRIORITY.NORMAL - 1
    );
  }
  fail() {
    if (this.failed) return;
    this.failed = true;
    this.suspend();
    this.host.ui.notifications.warn(localize(this.host, "RAT.Unsupported"));
  }

  updatePolicy() {
    if (
      this.context &&
      this.retainedContext &&
      !sceneRetainsMemory(this.host.canvas.scene)
    )
      this.cache.removeRetained(this.context);
    this.retainedContext = sceneRetainsMemory(this.host.canvas.scene);
    this.store.setPolicy(
      memoryPolicy(
        this.host.game.settings,
        this.host.canvas.scene,
        this.host.game.system?.id
      )
    );
    this.store.setCombat(this.adapter.combat());
    if (this.context && this.host.canvas?.ready)
      this.renderer.sync(this.store.records());
    this.ensureTimer();
    this.notifyMemory();
  }

  ensureTimer() {
    const hasMemory =
      !sceneRetainsMemory(this.host.canvas.scene) &&
      this.store.remembered().length > 0;
    if (hasMemory && !this.timer)
      this.timer = this.host.setInterval(() => {
        try {
          // TTL sweeps only existing records, never polls tokens for observations.
          const records = this.store.records();
          if (this.host.canvas?.ready) this.renderer.sync(records);
          this.notifyMemory();
          this.ensureTimer();
        } catch {
          this.fail();
        }
      }, 1000);
    else if (!hasMemory && this.timer) {
      this.host.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** @param {any} document */
  deleted(document) {
    if (document.parent?.id !== this.host.canvas.scene?.id) return;
    const context = this.adapter.context();
    if (
      context &&
      document.object &&
      !this.adapter.visible(document.object, context)
    )
      this.store.loseSight(document.id);
    this.store.deleteToken(document.id);
    this.renderer.forgetVisibility(document.id);
    // A deleted remembered token may remain in the pending set; never resample it.
    for (const token of this.pending)
      if (token.document.id === document.id) this.pending.delete(token);
    for (const token of this.animating)
      if (token.document.id === document.id) this.animating.delete(token);
    if (this.context && this.host.canvas.ready)
      this.renderer.sync(this.store.records());
    this.ensureTimer();
    this.notifyMemory();
  }

  /** @param {boolean} [force] */
  notifyMemory(force = false) {
    const signature = JSON.stringify([
      this.status(),
      this.store
        .remembered()
        .map(record => [
          record.tokenId,
          record.snapshot.observedAt,
          this.renderer.label(record)
        ])
    ]);
    if (force || signature !== this.memorySignature) {
      this.memorySignature = signature;
      this.checkpoint(true);
      for (const listener of this.memoryListeners) {
        try {
          listener();
        } catch {
          /* An optional consumer cannot interrupt observation or cleanup. */
        }
      }
    }
  }

  clearMemory() {
    this.store.clear();
    this.renderer.clear();
    this.ensureTimer();
    this.notifyMemory();
    this.cache.clear();
    this.cache.clearRetained();
    // Do not immediately rescan: an explicit forget lasts until another native observation event.
  }

  /** Safe metadata only; observation and this status share the native context gate. */
  status() {
    let state = "suspended";
    if (!this.failed) {
      try {
        state = this.adapter.inspectContext().reason;
      } catch {
        state = "unsupported";
      }
    }
    return Object.freeze({
      state,
      canReport: Boolean(this.host.game.user?.isGM),
      rules: memoryRules(this.host)
    });
  }

  /** @param {boolean} [force] */
  checkpoint(force = false) {
    if (this.context) {
      if (this.retainedContext)
        this.cache.saveRetained(this.store, this.renderer, force);
      else this.cache.save(this.store, this.renderer, force);
    }
  }

  /** @param {Record<string, string>} images @param {string} key */
  async restoreImages(images, key) {
    await Promise.all(
      this.store.remembered().map(async record => {
        const data = images[record.tokenId];
        if (!isSavedImage(data) || this.renderer.textures.has(record.tokenId))
          return;
        // Preserve the saved bytes while decode is pending, including immediate repeated reloads.
        this.renderer.restoreImage(record.tokenId, null, data);
        try {
          const texture = await this.renderer.decodeImage(data);
          if (!texture) return;
          if (
            this.context !== key ||
            this.store.get(record.tokenId)?.snapshot !== record.snapshot
          ) {
            texture.destroy(true);
            if (this.context === key) this.renderer.sync(this.store.records());
            return;
          }
          this.renderer.restoreImage(record.tokenId, texture, data);
          this.renderer.sync(this.store.records());
        } catch {
          /* A corrupt local PNG falls back to the saved geometric marker. */
        }
      })
    );
  }

  /** @param {string} id */
  forget(id) {
    this.store.forget(id);
    this.renderer.sync(this.store.records());
    this.ensureTimer();
    this.notifyMemory();
  }

  diagnostics() {
    return {
      revision: "native-position-refresh-4",
      enabled: this.diagnosticsEnabled,
      failed: this.failed,
      contextEstablished: Boolean(this.context),
      collectionActive: Boolean(this.ticker),
      animating: this.animating.size,
      remembered: this.store.remembered().length,
      markers: this.renderer.markers.size,
      images: this.renderer.textures.size,
      samples: this.samples.map(sample => ({
        ...sample,
        lastObserved: sample.lastObserved ? { ...sample.lastObserved } : null
      }))
    };
  }
  /** Session-only support switch; never persists to settings. @param {boolean} enabled */
  setDiagnostics(enabled) {
    this.diagnosticsEnabled = enabled;
    this.samples.length = 0;
    return this.diagnostics();
  }
  suspend() {
    if (this.context) {
      if (this.retainedContext && !this.failed)
        this.cache.saveRetained(this.store, this.renderer);
      else this.cache.clear();
    }
    this.ticker?.remove(this.flush, this);
    this.ticker = null;
    if (this.timer) this.host.clearInterval(this.timer);
    this.timer = null;
    this.pending.clear();
    this.animating.clear();
    this.samples.length = 0;
    this.full = false;
    this.context = "";
    this.retainedContext = false;
    this.restoreAttempted = false;
    this.lastRemembered = 0;
    this.store.setContext(null);
    this.renderer.clear();
    this.notifyMemory();
  }
  reset() {
    this.suspend();
    this.schedule();
  }
}
