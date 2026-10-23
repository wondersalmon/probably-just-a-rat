import assert from "node:assert/strict";
import test from "node:test";
import { Ticker, UPDATE_PRIORITY } from "pixi.js";
import { MemoryStore } from "../scripts/core/memory-store.js";
import { ObservationTracker } from "../scripts/observation-tracker.js";
import { registerSettings } from "../scripts/settings.js";
import { runtimeHost, token } from "./helpers/runtime.mjs";

function fixture() {
  const f = runtimeHost();
  let time = 0;
  const store = new MemoryStore({ now: () => time });
  const tracker = new ObservationTracker(f.host, store);
  registerSettings(f.host.game.settings, key => {
    if (["memoryRounds", "memoryMinutes"].includes(key)) {
      tracker.updatePolicy();
      return;
    }
    tracker.renderer.rebuild();
    tracker.schedule();
  });
  const enemy = token(f.host);
  const update = target => {
    tracker.schedule(target);
    f.frame();
  };
  return {
    ...f,
    tracker,
    store,
    enemy,
    update,
    advance: ms => {
      time += ms;
      for (const fn of [...f.timers.values()]) fn();
    }
  };
}

test("overland scene retains only known positions through Hidden, elapsed time and combat changes", async () => {
  const f = fixture();
  let overland = true;
  f.host.canvas.scene.getFlag = (_namespace, key) =>
    key === "overlandMemory" && overland;
  await f.host.game.settings.set("probably-just-a-rat", "combatOnly", true);
  f.update();
  f.enemy.position.x = 60;
  f.enemy.mesh.position.x = 110;
  f.update(f.enemy);
  const snapshot = f.store.get("enemy").snapshot;
  f.enemy.document.hidden = true;
  f.enemy.visual = f.enemy.visible = false;
  Object.defineProperty(f.enemy, "position", {
    get() {
      throw new Error("Hidden position must not be read");
    }
  });
  f.update(f.enemy);
  const unknown = token(f.host, "unknown");
  unknown.document.hidden = true;
  f.update(unknown);
  assert.equal(f.store.get("unknown"), undefined);
  assert.equal(f.store.get("enemy").snapshot, snapshot);
  assert.equal(f.timers.size, 0);
  f.advance(10 * 24 * 60 * 60 * 1000);
  for (const combat of [
    { id: "fight-a", started: true, scene: null, round: 1, turn: 0 },
    { id: "fight-a", started: true, scene: null, round: 50, turn: 0 },
    null,
    { id: "fight-b", started: true, scene: null, round: 1, turn: 0 },
    null
  ]) {
    f.host.game.combat = combat;
    f.update();
    assert.equal(f.store.get("enemy").snapshot, snapshot);
    assert.equal(f.tracker.renderer.markers.size, 1);
  }
  overland = false;
  f.update();
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  assert.equal(f.tracker.failed, false);
  f.tracker.suspend();
});

test("overland markers disappear on rediscovery, manual forgetting and scene changes", () => {
  const f = fixture();
  f.host.canvas.scene.getFlag = () => true;
  f.update();
  f.enemy.visual = f.enemy.visible = false;
  f.update(f.enemy);
  assert.equal(f.tracker.renderer.markers.size, 1);
  f.enemy.visual = f.enemy.visible = true;
  f.update(f.enemy);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.enemy.visual = f.enemy.visible = false;
  f.update(f.enemy);
  f.tracker.forget("enemy");
  assert.equal(f.store.size, 0);
  f.enemy.visual = f.enemy.visible = true;
  f.update(f.enemy);
  f.enemy.visual = f.enemy.visible = false;
  f.update(f.enemy);
  f.host.canvas.scene = { id: "other-scene", getFlag: () => true };
  f.update();
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.tracker.suspend();
});

test("a timer rendering failure stops observation and releases the repeated callback", () => {
  const f = fixture();
  f.update();
  f.enemy.visual = f.enemy.visible = false;
  f.update(f.enemy);
  f.tracker.renderer.sync = () => {
    throw new Error("Renderer unavailable");
  };
  assert.doesNotThrow(() => f.advance(1000));
  assert.equal(f.tracker.failed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  assert.equal(f.warnings.length, 1);
});

test("combat-only mode rejects absent, unstarted and other-scene combats but accepts scene and global combats", async () => {
  const f = fixture();
  await f.host.game.settings.set("probably-just-a-rat", "combatOnly", true);
  for (const combat of [
    null,
    { id: "fight", started: false, scene: null, round: 0, turn: null },
    { id: "fight", started: true, scene: { id: "other" }, round: 1, turn: 0 }
  ]) {
    f.host.game.combat = combat;
    f.enemy.visual = true;
    f.update();
    f.enemy.visual = false;
    f.update();
    assert.equal(f.store.size, 0);
    assert.equal(f.tracker.renderer.markers.size, 0);
    assert.equal(f.timers.size, 0);
  }
  for (const scene of [{ id: "scene" }, null]) {
    f.host.game.combat = {
      id: "fight",
      started: true,
      scene,
      round: 1,
      turn: 0
    };
    f.enemy.visual = true;
    f.update();
    f.enemy.visual = false;
    f.update();
    assert.equal(f.tracker.renderer.markers.size, 1);
    f.host.game.combat = null;
    f.update();
    assert.equal(f.store.size, 0);
    assert.equal(f.tracker.renderer.markers.size, 0);
    assert.equal(f.timers.size, 0);
  }
  f.tracker.suspend();
});

test("GM lifetime changes apply to existing out-of-combat memories without restarting their age", async () => {
  const f = fixture();
  await f.host.game.settings.set("probably-just-a-rat", "memoryMinutes", 3);
  f.update();
  f.enemy.visual = false;
  f.update();
  const snapshot = f.store.get("enemy").snapshot;
  f.advance(60000);
  assert.equal(f.store.get("enemy").snapshot, snapshot);
  await f.host.game.settings.set("probably-just-a-rat", "memoryMinutes", 1);
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  assert.equal(f.timers.size, 0);
  await f.host.game.settings.set("probably-just-a-rat", "memoryMinutes", 10);
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("GM combat lifetime uses configured rounds and shortening it immediately expires old ghosts", async () => {
  const f = fixture();
  f.host.game.combat = {
    id: "fight",
    started: true,
    scene: null,
    round: 1,
    turn: 0
  };
  await f.host.game.settings.set("probably-just-a-rat", "memoryRounds", 4);
  f.update();
  f.enemy.visual = false;
  f.update();
  f.host.game.combat.round = 3;
  f.update();
  assert.equal(f.tracker.renderer.markers.size, 1);
  await f.host.game.settings.set("probably-just-a-rat", "memoryRounds", 2);
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  await f.host.game.settings.set("probably-just-a-rat", "memoryRounds", 8);
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("visible idle time does not consume memory lifetime and hidden events cannot extend it", () => {
  const f = fixture();
  f.update();
  const snapshot = f.store.get("enemy").snapshot;
  f.advance(301000);
  f.enemy.visible = f.enemy.visual = false;
  f.update();
  assert.equal(f.store.get("enemy")?.state, "remembered");
  assert.equal(f.store.get("enemy").snapshot, snapshot);
  f.advance(59000);
  f.update();
  assert.equal(f.tracker.renderer.markers.size, 1);
  f.advance(1000);
  assert.equal(f.store.get("enemy"), undefined);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.tracker.suspend();
});

test("global combat uses round expiry, combat-end clearing and rejects another scene", () => {
  const f = fixture();
  f.host.game.combat = {
    id: "global",
    started: true,
    scene: null,
    round: 1,
    turn: 0
  };
  f.update();
  assert.equal(f.store.get("enemy").snapshot.combat?.id, "global");
  f.enemy.visible = f.enemy.visual = false;
  f.update();
  f.advance(301000);
  assert.equal(f.store.remembered().length, 1);
  f.host.game.combat.round = 3;
  f.update();
  assert.equal(f.store.size, 0);
  f.enemy.visible = f.enemy.visual = true;
  f.update();
  f.enemy.visible = f.enemy.visual = false;
  f.update();
  f.host.game.combat = null;
  f.update();
  assert.equal(f.store.size, 0);
  f.host.game.combat = {
    id: "other",
    started: true,
    scene: { id: "other-scene" },
    round: 1,
    turn: 0
  };
  assert.equal(f.tracker.adapter.combat(), null);
  f.tracker.suspend();
});

test("unknown hidden enemies never receive a snapshot, texture or marker", () => {
  const f = fixture();
  f.enemy.visual = false;
  f.enemy.visible = false;
  f.update();
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.textures.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.tracker.suspend();
});

test("last rendered position survives five hidden moves and image/name/actor changes", () => {
  const f = fixture();
  f.update();
  const snapshot = f.store.get("enemy").snapshot;
  assert.equal(snapshot.x, 20);
  assert.equal(snapshot.texture, "observed.webp");
  assert.equal(snapshot.name, "Known enemy");
  assert.equal(f.enemy.document.lastTestPosition.x, 20);
  f.enemy.visible = f.enemy.visual = false;
  f.update(f.enemy);
  const owned = f.tracker.renderer.textures.get("enemy").texture;
  for (let i = 0; i < 5; i++) {
    f.enemy.position.x = 1000 + i;
    f.enemy.document.x = 2000 + i;
    f.enemy.nameplate.text = "New hidden name";
    f.enemy.texture = {
      ...f.enemy.texture,
      baseTexture: {
        resource: { source: { tagName: "IMG", src: "hidden-form.webp" } }
      }
    };
    f.enemy.actor = new Proxy(
      {},
      {
        get() {
          throw new Error("Hidden Actor must not be read");
        }
      }
    );
    f.update(f.enemy);
    assert.equal(f.store.get("enemy").snapshot, snapshot);
    assert.equal(f.tracker.renderer.textures.get("enemy").texture, owned);
  }
  assert.equal(
    f.tracker.renderer.markers.get("enemy").container.position.x,
    20
  );
  f.tracker.suspend();
  assert.equal(owned.destroyed, true);
});

test("animated movement records displayed intermediate positions and rediscovery removes the marker", () => {
  const f = fixture();
  f.update();
  f.enemy.position.x = 200;
  f.enemy.mesh.position.x = 250;
  f.update(f.enemy);
  f.enemy.position.x = 300;
  f.enemy.mesh.position.x = 350;
  f.enemy.visual = false;
  f.update(f.enemy);
  assert.equal(f.store.get("enemy").snapshot.x, 200);
  assert.equal(f.tracker.renderer.markers.size, 1);
  f.enemy.position.x = 100;
  f.enemy.mesh.position.x = 150;
  f.enemy.visual = true;
  f.update(f.enemy);
  assert.equal(f.store.get("enemy").snapshot.x, 100);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.tracker.suspend();
});

test("special detection and inconsistent animation representations cannot create a snapshot", () => {
  const f = fixture();
  f.enemy.visual = false;
  f.enemy.lightVisual = false;
  f.enemy.detectionFilter = null; // A missing special filter alone does not prove visual sight.
  f.update();
  assert.equal(f.store.size, 0);
  f.enemy.visual = true;
  f.enemy.mesh.position.x = 999;
  f.update(f.enemy);
  assert.equal(f.store.size, 0);
  f.enemy.mesh.position.x = 70;
  f.enemy.lightVisual = true;
  f.enemy.visual = false;
  f.update(f.enemy);
  assert.equal(f.store.size, 1);
  f.tracker.suspend();
});

test("one continuous animation freezes its last visible frame without intermediate refresh hooks", () => {
  const f = fixture();
  f.update();
  f.enemy.document.x = 900; // The destination must never become an observation.
  f.enemy.animationContexts.set("movement", {});
  f.tracker.schedule(f.enemy); // One native update starts the animation.
  for (const x of [40, 80, 120, 160, 200]) {
    f.enemy.position.x = x;
    f.enemy.mesh.position.x = x + 50;
    f.frame(); // No additional module scheduling or refresh hook.
    assert.equal(f.store.get("enemy").snapshot.x, x);
    assert.equal(f.frames.size, 1);
  }
  const lastVisible = f.store.get("enemy").snapshot;
  f.enemy.visual = f.enemy.visible = false;
  for (const x of [300, 600, 900]) {
    f.enemy.position.x = x;
    f.enemy.mesh.position.x = x + 50;
    f.frame();
    assert.equal(f.store.get("enemy").snapshot, lastVisible);
    assert.equal(
      f.tracker.renderer.markers.get("enemy").container.position.x,
      200
    );
  }
  f.enemy.animationContexts.clear();
  f.frame();
  assert.equal(f.frames.size, 0);
  assert.equal(f.tracker.animating.size, 0);
  f.tracker.suspend();
});

test("coalesced native refreshes retain sight gaps instead of deriving a heading from unseen movement", () => {
  const f = fixture();
  f.update();
  f.enemy.position.x = 100;
  f.enemy.mesh.position.x = 150;
  f.tracker.refreshed(f.enemy, { refreshPosition: true });
  assert.equal(f.store.get("enemy").snapshot.movementAngle, 90);
  f.enemy.visual = f.enemy.visible = false;
  f.tracker.refreshed(f.enemy, { refreshPosition: true });
  assert.equal(f.store.get("enemy").state, "remembered");
  f.enemy.position.x = 700;
  f.enemy.mesh.position.x = 750;
  f.enemy.visual = f.enemy.visible = true;
  f.tracker.refreshed(f.enemy, { refreshPosition: true });
  assert.equal(f.store.get("enemy").snapshot.movementAngle, 0);
  f.tracker.suspend();
});

test("observer animation checks stationary targets and cancels frame sampling on teardown", () => {
  const f = fixture();
  f.update();
  f.observer.animationContexts.set("movement", {});
  f.tracker.schedule(f.observer);
  f.frame();
  f.enemy.visual = false;
  f.frame(); // Only the observer is moving; no enemy refresh was emitted.
  assert.equal(f.store.get("enemy").state, "remembered");
  f.enemy.visual = true;
  f.frame();
  assert.equal(f.store.get("enemy").state, "observed");
  f.tracker.suspend();
  assert.equal(f.frames.size, 0);
  assert.equal(f.tracker.animating.size, 0);
  assert.equal(f.timers.size, 0);
});

test("real PIXI ticker samples after native Token animation and render flags, then releases its listener", () => {
  const f = fixture();
  const ticker = new Ticker();
  f.host.canvas.app.ticker = ticker;
  f.tracker.setDiagnostics(true);
  const positions = [20, 80, 160, 240, 400, 700];
  let frame = 0;
  f.enemy.animationContexts.set("movement", {});
  // Match Foundry's priorities rather than hard-coding values for PIXI's HIGH.
  const objectsPriority = UPDATE_PRIORITY.HIGH - 2;
  ticker.add(
    () => {
      f.enemy.document.x = positions[frame];
      if (++frame === positions.length) f.enemy.animationContexts.clear();
    },
    undefined,
    objectsPriority + 1
  );
  ticker.add(
    () => {
      f.enemy.position.x = f.enemy.document.x;
      f.enemy.mesh.position.x = f.enemy.position.x + 50;
      f.enemy.visible = f.enemy.visual = f.enemy.position.x < 300;
      if (frame === 1) f.tracker.schedule(f.enemy);
    },
    undefined,
    objectsPriority
  );
  ticker.add(() => {}, undefined, UPDATE_PRIORITY.NORMAL + 2); // Perception.
  try {
    for (let i = 0; i < positions.length; i++) ticker.update(100 + i * 20);
    assert.equal(f.store.get("enemy").snapshot.x, 240);
    assert.equal(
      f.tracker.renderer.markers.get("enemy").container.position.x,
      240
    );
    assert.equal(ticker.count, 3); // Only the three fixture engine listeners remain.
    assert.equal(f.tracker.ticker, null);
    assert.deepEqual(
      f.tracker.diagnostics().samples.map(s => s.lastObserved.x),
      [20, 80, 160, 240, 240, 240]
    );
  } finally {
    f.tracker.suspend();
    ticker.destroy();
  }
});

test("bounded diagnostics report rejection causes without revealing hidden position or appearance", () => {
  const f = fixture();
  f.tracker.setDiagnostics(true);
  f.update();
  f.enemy.position.x = 1000;
  f.enemy.mesh.position.x = 1200; // Deliberately inconsistent representation.
  f.enemy.nameplate.text = "hidden-name";
  for (let i = 0; i < 70; i++) f.update(f.enemy);
  const diagnostic = f.tracker.diagnostics();
  assert.equal(diagnostic.samples.length, 64);
  assert.equal(diagnostic.samples.at(-1).reason, "mesh-position-mismatch");
  assert.deepEqual(diagnostic.samples.at(-1).lastObserved, { x: 20, y: 30 });
  assert.equal(JSON.stringify(diagnostic).includes("1000"), false);
  assert.equal(JSON.stringify(diagnostic).includes("1200"), false);
  assert.equal(JSON.stringify(diagnostic).includes("hidden-name"), false);
  diagnostic.samples[0].lastObserved.x = 999;
  assert.equal(f.tracker.diagnostics().samples[0].lastObserved.x, 20);
  f.tracker.suspend();
  assert.deepEqual(f.tracker.diagnostics().samples, []);
});

test("observer changes recompute enemies; unrestricted GM and unavailable permissions clear context", () => {
  const f = fixture();
  f.update();
  f.enemy.visual = false;
  f.update();
  assert.equal(f.store.remembered().length, 1);
  f.observer.allowed = false;
  f.update();
  assert.equal(f.store.size, 0);
  f.observer.allowed = true;
  f.enemy.visual = true;
  f.host.game.user.isGM = true;
  f.update();
  assert.equal(f.store.size, 0);
  f.observer.controlled = true;
  f.update();
  assert.equal(f.store.size, 1);
  f.host.canvas.visibility.tokenVision = false;
  f.update();
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("level and source changes clear old markers; previews do not contribute vision", () => {
  const f = fixture();
  f.update();
  f.enemy.visual = false;
  f.update();
  assert.equal(f.tracker.renderer.markers.size, 1);
  f.source.isPreview = true;
  f.update();
  assert.equal(f.store.size, 0);
  f.source.isPreview = false;
  f.enemy.visual = true;
  f.update();
  f.host.canvas.level.id = "upstairs";
  f.update();
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.tracker.suspend();
});

test("GM can keep an observed snapshot on Hidden without reading hidden geometry or extending its lifetime", async () => {
  const f = fixture();
  await f.host.game.settings.set("probably-just-a-rat", "rememberHidden", true);
  f.update();
  const snapshot = f.store.get("enemy").snapshot;
  const image = f.tracker.renderer.textures.get("enemy").texture;
  f.enemy.document.hidden = true;
  for (const key of ["x", "y", "name", "texture"])
    Object.defineProperty(f.enemy.document, key, {
      get() {
        throw new Error("Hidden document read");
      }
    });
  Object.defineProperty(f.enemy, "position", {
    get() {
      throw new Error("Hidden geometry read");
    }
  });
  f.update(f.enemy);
  assert.equal(f.store.get("enemy").snapshot, snapshot);
  assert.equal(f.store.get("enemy").state, "remembered");
  assert.equal(f.tracker.renderer.textures.get("enemy").texture, image);
  assert.equal(
    f.tracker.renderer.markers.get("enemy").container.position.x,
    snapshot.x
  );
  f.advance(59000);
  f.update(f.enemy);
  f.advance(1000);
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  assert.equal(f.tracker.failed, false);
  f.tracker.suspend();
});

test("Hidden memory never reveals unknown tokens and turning the GM rule off cannot resurrect them", async () => {
  const f = fixture();
  await f.host.game.settings.set("probably-just-a-rat", "rememberHidden", true);
  f.enemy.document.hidden = true;
  f.update();
  assert.equal(f.store.size, 0);
  f.enemy.document.hidden = false;
  f.update();
  f.enemy.document.hidden = true;
  f.update();
  assert.equal(f.store.remembered().length, 1);
  await f.host.game.settings.set(
    "probably-just-a-rat",
    "rememberHidden",
    false
  );
  f.frame();
  assert.equal(f.store.size, 0);
  await f.host.game.settings.set("probably-just-a-rat", "rememberHidden", true);
  f.frame();
  assert.equal(f.store.size, 0);
  f.enemy.document.hidden = false;
  f.update();
  f.enemy.document.hidden = true;
  f.enemy.document.override = "off";
  f.update();
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("blinded observers lose visual contact even if the target's rendered visibility is stale", () => {
  const f = fixture();
  f.update();
  const snapshot = f.store.get("enemy").snapshot;
  f.source.isBlinded = true;
  f.update();
  assert.equal(f.store.get("enemy").state, "remembered");
  assert.equal(f.store.get("enemy").snapshot, snapshot);
  f.source.isBlinded = false;
  f.update();
  assert.equal(f.store.get("enemy").state, "observed");
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.tracker.suspend();
});

test("Hidden removes memory while unseen deletion retains it until real TTL expiry", () => {
  const f = fixture();
  f.update();
  f.enemy.document.hidden = true;
  f.update(f.enemy);
  assert.equal(f.store.size, 0);
  f.enemy.document.hidden = false;
  f.enemy.visual = false;
  f.update(f.enemy);
  assert.equal(f.store.size, 0);
  f.enemy.visual = true;
  f.update(f.enemy);
  f.enemy.visual = false;
  f.enemy.visible = false;
  f.tracker.deleted(f.enemy.document);
  f.host.canvas.tokens.placeables = f.host.canvas.tokens.placeables.filter(
    token => token !== f.enemy
  );
  assert.equal(f.store.remembered().length, 1);
  assert.equal(
    f.timers.size,
    1,
    "deletion must start expiry without another observation event"
  );
  f.advance(60000);
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  assert.equal(f.timers.size, 0);
  f.tracker.suspend();
});

test("candidate defaults, per-token overrides and explicit opt-out never bypass visibility", () => {
  const f = fixture();
  f.enemy.document.disposition = 0;
  f.update();
  assert.equal(f.store.size, 0);
  f.enemy.document.override = "on";
  f.enemy.visual = false;
  f.update();
  assert.equal(f.store.size, 0);
  f.enemy.visual = true;
  f.update();
  assert.equal(f.store.size, 1);
  f.enemy.document.override = "off";
  f.update();
  assert.equal(f.store.size, 0);
  f.tracker.suspend();
});

test("events batch into one post-perception callback and idle observation has no ticker or timer", () => {
  const f = fixture();
  f.tracker.schedule(f.enemy);
  f.tracker.schedule(f.enemy);
  f.tracker.schedule();
  assert.equal(f.frames.size, 1);
  assert.equal([...f.frames.values()][0].priority, -1);
  f.frame();
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  f.tracker.schedule(f.enemy);
  f.tracker.suspend();
  assert.equal(f.frames.size, 0);
  assert.equal(f.store.size, 0);
  assert.equal(f.host.canvas.interface.children.length, 0);
});

test("unsupported API suspends once instead of leaking documents or repeatedly throwing", () => {
  const f = fixture();
  f.host.canvas.visibility._createVisibilityTestConfig = null;
  f.update();
  f.update();
  assert.equal(f.warnings.length, 1);
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.failed, true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
});

test("video textures use a geometry-only marker and shared textures are never destroyed", () => {
  const f = fixture();
  const shared = f.enemy.texture;
  shared.baseTexture.resource.source = {
    tagName: "VIDEO",
    src: "observed.webm"
  };
  f.update();
  f.enemy.visual = false;
  f.update();
  assert.equal(f.store.get("enemy").snapshot.texture, null);
  assert.equal(f.tracker.renderer.textures.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 1);
  const marker = f.tracker.renderer.markers.get("enemy").container;
  assert.equal(marker.eventMode, "none");
  assert.equal(marker.interactiveChildren, false);
  f.tracker.suspend();
  assert.equal(shared.destroyed, false);
});

test("PIXI Assets ImageBitmap textures retain the observed image without reading the document path", () => {
  for (const pathField of ["src", "url"]) {
    const f = fixture();
    const nativeTexture = f.enemy.texture;
    nativeTexture.baseTexture.resource = {
      [pathField]: "observed-bitmap.webp",
      source: { width: 100, height: 100 } // ImageBitmap has no HTMLImageElement.src.
    };
    Object.defineProperty(f.enemy.document, "texture", {
      get() {
        throw new Error("The unrendered document path must not be read");
      }
    });
    f.update();
    assert.equal(f.store.get("enemy").snapshot.texture, "observed-bitmap.webp");
    const copy = f.tracker.renderer.textures.get("enemy").texture;
    f.enemy.visible = f.enemy.visual = false;
    nativeTexture.baseTexture.resource[pathField] = "hidden-bitmap.webp";
    f.update(f.enemy);
    const marker = f.tracker.renderer.markers.get("enemy").container;
    const image = marker.children.find(
      child => child.name === "rat-ghost-image"
    );
    assert.equal(image.texture, copy);
    assert.equal(image.alpha, 0.5);
    assert.equal(marker.eventMode, "none");
    assert.equal(marker.interactiveChildren, false);
    assert.equal(f.store.get("enemy").snapshot.texture, "observed-bitmap.webp");
    f.enemy.visible = f.enemy.visual = true;
    f.update(f.enemy);
    assert.equal(f.tracker.renderer.markers.size, 0);
    f.tracker.suspend();
    assert.equal(nativeTexture.destroyed, false);
  }
});

test("GM name rule remembers a visible token name without a nameplate and never reads it while disabled", async () => {
  const f = fixture();
  f.enemy.nameplate.visible = false;
  f.enemy._canViewMode = () => false;
  f.update();
  assert.equal(f.store.get("enemy").snapshot.name, "Known enemy");
  f.enemy.visible = f.enemy.visual = false;
  f.enemy.document.name = "Changed while hidden";
  f.update(f.enemy);
  assert.equal(f.store.get("enemy").snapshot.name, "Known enemy");
  await f.host.game.settings.set("probably-just-a-rat", "showNames", false);
  f.frame();
  assert.equal(
    f.tracker.renderer.caption(f.store.get("enemy")),
    "RAT.LastPosition"
  );
  f.enemy.visible = f.enemy.visual = true;
  Object.defineProperty(f.enemy.document, "name", {
    get() {
      throw new Error("Disabled names must not be read");
    }
  });
  f.update(f.enemy);
  assert.equal(f.tracker.failed, false);
  assert.equal(f.store.get("enemy").snapshot.name, "");
  f.tracker.suspend();
});

test("special detection and hidden movement cannot alter frozen visual occlusion bounds", () => {
  const f = fixture();
  f.update();
  assert.equal(f.tracker.renderer.visibleBounds.get("enemy").x, 20);
  f.enemy.visual = false;
  f.enemy.position.x = 600;
  f.enemy.mesh.position.x = 650;
  // A native/third-party special mode may still show a detection outline.
  f.enemy.visible = true;
  f.enemy.mesh.visible = true;
  f.update(f.enemy);
  assert.equal(f.tracker.renderer.visibleBounds.has("enemy"), false);
  assert.equal(f.store.get("enemy").snapshot.x, 20);
  assert.equal(
    f.tracker.renderer.markers.get("enemy").container.position.x,
    20
  );
  f.tracker.suspend();
});

test("Secret disposition never reads a player's unavailable name even with an explicit memory override", () => {
  const f = fixture();
  f.enemy.document.disposition = f.host.CONST.TOKEN_DISPOSITIONS.SECRET;
  f.enemy.document.override = "on";
  Object.defineProperty(f.enemy.document, "name", {
    get() {
      throw new Error("Secret name read");
    }
  });
  f.update();
  assert.equal(f.tracker.failed, false);
  assert.equal(f.store.get("enemy").snapshot.name, "");
  f.enemy.visual = f.enemy.visible = false;
  f.update(f.enemy);
  assert.equal(
    f.tracker.renderer.caption(f.store.get("enemy")),
    "RAT.Unknown\nRAT.LastPosition"
  );
  f.tracker.suspend();
});

test("multiple native vision sources can detect independently and removing a source clears history", () => {
  const f = fixture();
  const ally = token(f.host, "ally");
  ally.document.disposition = 1;
  ally.document.isOwner = true;
  ally.actor = { testUserPermission: () => true };
  ally.document.detectionModes = { basicSight: { enabled: true } };
  f.host.canvas.effects.visionSources.set("ally-source", {
    active: true,
    object: ally,
    x: 100,
    y: 100
  });
  f.host.CONFIG.Canvas.detectionModes.basicSight.testVisibility = source =>
    source.object === ally;
  f.update();
  assert.equal(f.store.get("enemy").state, "observed");
  f.host.canvas.effects.visionSources.delete("ally-source");
  f.update();
  assert.equal(f.store.size, 0);
  assert.equal(f.tracker.renderer.markers.size, 0);
  f.tracker.suspend();
});

test("100 tokens and 20 markers release all owned textures on repeated scene teardown", () => {
  const f = fixture();
  const enemies = [f.enemy];
  for (let i = 1; i < 100; i++) enemies.push(token(f.host, `enemy-${i}`));
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const enemy of enemies) enemy.visual = true;
    f.update();
    assert.equal(f.store.size, 100);
    for (const enemy of enemies.slice(0, 20)) enemy.visual = false;
    f.update();
    assert.equal(f.tracker.renderer.markers.size, 20);
    const owned = [...f.tracker.renderer.textures.values()].map(
      entry => entry.texture
    );
    f.tracker.suspend();
    assert.equal(f.tracker.renderer.textures.size, 0);
    assert.equal(f.tracker.renderer.markers.size, 0);
    assert.equal(f.host.canvas.interface.children.length, 0);
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    assert.ok(owned.every(texture => texture.destroyed));
    assert.ok(enemies.every(enemy => !enemy.texture.destroyed));
  }
});

test("existing grayscale ghosts do not prevent later observations, animated losses or independent rediscovery", () => {
  const f = fixture();
  f.settings.get("grayscale").value = 100;
  f.update();
  f.enemy.visual = f.enemy.visible = false;
  f.update(f.enemy);
  const first = f.tracker.renderer.markers.get("enemy");
  assert.ok(first);
  const second = token(f.host, "second");
  second.position.x = 250;
  second.mesh.position.x = 300;
  f.update(second); // First ghost already exists before this new token is observed.
  second.visual = second.visible = false;
  f.update(second);
  assert.equal(f.tracker.renderer.markers.size, 2);
  assert.equal(f.tracker.renderer.markers.get("enemy"), first);
  const third = token(f.host, "third");
  third.position.x = 450;
  third.mesh.position.x = 500;
  third.animationContexts.set("move", {});
  f.update(third);
  third.position.x = 475;
  third.mesh.position.x = 525;
  f.frame();
  third.visual = third.visible = false;
  third.position.x = 1000;
  third.mesh.position.x = 1050;
  third.animationContexts.clear();
  f.frame(); // Continuous movement without an extra target refresh hook.
  assert.deepEqual(
    [...f.tracker.renderer.markers.keys()],
    ["enemy", "second", "third"]
  );
  assert.deepEqual(
    f.store.remembered().map(record => record.snapshot.x),
    [20, 250, 475]
  );
  const markers = [...f.tracker.renderer.markers.values()];
  assert.ok(
    markers.every(
      marker =>
        marker.container.children.filter(
          child => child.name === "rat-ghost-echo"
        ).length === 0
    )
  );
  assert.equal(new Set(markers.flatMap(marker => marker.filters)).size, 3);
  second.visual = second.visible = true;
  f.update(second);
  assert.deepEqual([...f.tracker.renderer.markers.keys()], ["enemy", "third"]);
  assert.equal(f.tracker.renderer.markers.get("enemy"), first);
  assert.ok(markers[1].filters.every(filter => filter.destroyed));
  assert.ok(first.filters.every(filter => !filter.destroyed));
  f.tracker.forget("enemy");
  assert.deepEqual([...f.tracker.renderer.markers.keys()], ["third"]);
  f.tracker.suspend();
  assert.ok(markers.every(marker => marker.container.destroyed));
});
