import { MemoryStore } from "/scripts/core/memory-store.js";
import { ObservationTracker } from "/scripts/observation-tracker.js";
import { registerSettings } from "/scripts/settings.js";
import { CombatMemoryPing } from "/scripts/combat-memory-ping.js";
import { SettingsPreview } from "/scripts/foundry/settings-preview.js";

const language = new URL(location.href).searchParams.get("lang") ?? "en";
const detailed = new URL(location.href).searchParams.has("detailed");
const strings = await (await fetch(`/lang/${language}.json`)).json();
const app = new PIXI.Application({
  width: 900,
  height: 650,
  backgroundColor: 0x181a20,
  preserveDrawingBuffer: true
});
document.body.append(app.view);
const background = new PIXI.Graphics()
  .beginFill(0x313744)
  .drawRect(0, 0, 510, 650)
  .endFill();
background.lineStyle(1, 0x565c68, 0.3);
for (let i = 0; i < 650; i += 100) {
  background.moveTo(0, i).lineTo(510, i);
  background.moveTo(i, 0).lineTo(i, 650);
}
background.lineStyle(8, 0xaaaaaa).moveTo(260, 0).lineTo(260, 650);
app.stage.addChild(background);
if (detailed) {
  background.beginFill(0x929292).drawRect(0, 0, 510, 650).endFill();
  background.lineStyle(2, 0x171717, 0.9);
  for (let y = 0; y < 650; y += 17)
    for (let x = 0; x < 510; x += 23) {
      const drift = Math.sin(x * 0.7 + y) * 7;
      background
        .moveTo(x + drift, y)
        .lineTo(x + 21, y + 5)
        .lineTo(x + 25, y + 19)
        .lineTo(x + 2, y + 17)
        .lineTo(x + drift, y);
    }
  background.beginFill(0x000000, 0.65).drawRect(0, 0, 150, 650).endFill();
  app.stage.scale.set(2);
}
const overlay = new PIXI.Container();
app.stage.addChild(overlay);
const imageCanvas = document.createElement("canvas");
imageCanvas.width = imageCanvas.height = 100;
const context2d = imageCanvas.getContext("2d");
context2d.fillStyle = "#81b665";
context2d.beginPath();
context2d.arc(50, 50, 40, 0, Math.PI * 2);
context2d.fill();
context2d.fillStyle = "#182011";
context2d.fillRect(28, 35, 12, 12);
context2d.fillRect(60, 35, 12, 12);
context2d.fillRect(35, 65, 30, 6);
if (detailed) {
  context2d.clearRect(0, 0, 100, 100);
  context2d.fillStyle = "#1d2228";
  context2d.beginPath();
  context2d.moveTo(48, 15);
  context2d.lineTo(56, 5);
  context2d.lineTo(63, 20);
  context2d.lineTo(72, 24);
  context2d.lineTo(62, 31);
  context2d.lineTo(94, 8);
  context2d.lineTo(87, 48);
  context2d.lineTo(67, 61);
  context2d.lineTo(72, 88);
  context2d.lineTo(60, 82);
  context2d.lineTo(51, 96);
  context2d.lineTo(44, 80);
  context2d.lineTo(25, 91);
  context2d.lineTo(32, 59);
  context2d.lineTo(9, 48);
  context2d.lineTo(5, 8);
  context2d.lineTo(42, 32);
  context2d.closePath();
  context2d.fill();
  context2d.save();
  context2d.clip();
  for (let y = 12; y < 95; y += 7) {
    context2d.globalCompositeOperation = "destination-out";
    context2d.globalAlpha = y % 3 === 0 ? 1 : 0.72;
    context2d.fillRect(13, y, 73, 2);
    context2d.globalCompositeOperation = "source-atop";
    context2d.globalAlpha = 0.7;
    context2d.fillStyle = "#4d545b";
    context2d.fillRect(18, y + 3, 60, 2);
  }
  context2d.restore();
}
const image = new Image();
image.src = imageCanvas.toDataURL();
await image.decode();
const texture = PIXI.Texture.from(image);
const mesh = new PIXI.Sprite(texture);
mesh.anchor.set(0.5);
mesh.position.set(150, 180);
mesh.elevation = 0;
app.stage.addChild(mesh);
const token = {
  _canViewMode: () => true,
  document: {
    id: "enemy",
    name: "Goblin <script>unsafe</script>",
    parent: { id: "scene" },
    level: "floor",
    hidden: false,
    disposition: -1,
    isOwner: false,
    getFlag: () => undefined,
    getVisibilityTestPoints: ({ x, y, elevation }) => [
      { x: x + 50, y: y + 50, elevation }
    ]
  },
  position: { x: 100, y: 130 },
  w: 100,
  h: 100,
  texture,
  mesh,
  visible: true,
  nameplate: { visible: true, text: "Goblin <script>unsafe</script>" }
};
token.document.object = token;
const settings = new Map();
const observer = {
  controlled: true,
  document: {
    level: "floor",
    hidden: false,
    isOwner: true,
    detectionModes: { basicSight: { enabled: true } }
  },
  actor: { testUserPermission: () => true }
};
const pingCalls = [];
const host = {
  PIXI,
  document,
  foundry: { canvas: { loadTexture: src => PIXI.Assets.load(src) } },
  fetch: window.fetch.bind(window),
  setInterval: window.setInterval.bind(window),
  clearInterval: window.clearInterval.bind(window),
  CONST: { TOKEN_DISPOSITIONS: { HOSTILE: -1 } },
  canvas: {
    ready: true,
    stage: app.stage,
    ping: position => pingCalls.push({ position, shared: true }),
    controls: {
      handlePing: (_user, position, options) =>
        pingCalls.push({ position, shared: false, ...options })
    },
    scene: { id: "scene" },
    level: { id: "floor" },
    app,
    interface: overlay,
    visibility: {
      tokenVision: true,
      _createVisibilityTestConfig: (points, options) => ({
        tests: points.map(point => ({ point })),
        object: options.object
      })
    },
    dimensions: {
      rect: { x: 0, y: 0, width: 900, height: 650 },
      sceneRect: { contains: (x, y) => x >= 0 && y >= 0 && x < 900 && y < 650 }
    },
    tokens: { placeables: [token] },
    effects: {
      visionSources: new Map([
        ["hero", { active: true, object: observer, x: 100, y: 100 }]
      ])
    }
  },
  game: {
    system: {
      id: new URL(location.href).searchParams.get("system") ?? "dnd5e"
    },
    user: {
      id: "player",
      role: 1,
      isGM: new URL(location.href).searchParams.has("gm"),
      hasPermission: () => true
    },
    combat: null,
    settings: {
      register: (_ns, key, data) =>
        settings.set(key, { ...data, value: data.default }),
      get: (_ns, key) => settings.get(key)?.value,
      set: async (_ns, key, value) => {
        const entry = settings.get(key);
        entry.value = value;
        entry.onChange();
      }
    },
    i18n: {
      localize: key => strings[key] ?? key,
      format: (key, values) =>
        Object.entries(values).reduce(
          (result, [name, value]) => result.replace(`{${name}}`, value),
          strings[key] ?? key
        )
    }
  },
  CONFIG: {
    Canvas: {
      pings: { types: { PULSE: "pulse", ALERT: "alert", PULL: "pull" } },
      detectionModes: {
        basicSight: {
          testVisibility: (_source, _mode, config) =>
            config.tests.some(test => test.point.x < 260)
        }
      }
    }
  },
  ui: {
    notifications: {
      warn: message => {
        throw new Error(message);
      }
    }
  }
};
const store = new MemoryStore();
const tracker = new ObservationTracker(host, store);
registerSettings(
  host.game.settings,
  key => {
    if (
      ["memoryRounds", "memoryMinutes", "daggerheartCombatMemory"].includes(key)
    ) {
      tracker.updatePolicy();
      tracker.renderer.refreshCaptions();
      return;
    }
    if (["labels", "showNames", "showRounds"].includes(key))
      tracker.renderer.refreshCaptions();
    else tracker.renderer.rebuild();
    tracker.schedule();
  },
  undefined,
  undefined,
  undefined,
  host.game.system.id
);
const pings = new CombatMemoryPing(host, tracker);
const preview = new SettingsPreview(host, values => {
  if (
    tracker.renderer.setPreview(values) &&
    tracker.context &&
    host.canvas.ready
  )
    tracker.renderer.sync(store.records());
});
let settingsWindow;
tracker.schedule();
window.__ratFixture = {
  pingCalls,
  tracker,
  store,
  texture,
  openSettings() {
    if (settingsWindow) this.closeSettings();
    const form = document.createElement("form");
    form.id = "settings-preview-fixture";
    form.style.cssText =
      "position:fixed;bottom:0;left:0;background:#222;padding:8px";
    // Native-like light DOM: the picker is named, its inner controls are not.
    const markerStyle = document.createElement("select");
    markerStyle.name = "probably-just-a-rat.markerStyle";
    for (const [value, label] of Object.entries(
      settings.get("markerStyle").choices
    )) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = strings[label];
      markerStyle.append(option);
    }
    markerStyle.value = host.game.settings.get(
      "probably-just-a-rat",
      "markerStyle"
    );
    if (host.game.user.isGM) {
      form.append(markerStyle);
      const group = document.createElement("div");
      group.className = "form-group";
      const picker = document.createElement("file-picker");
      picker.setAttribute("name", "probably-just-a-rat.customMarkerImage");
      const input = document.createElement("input");
      input.type = "text";
      input.value = host.game.settings.get(
        "probably-just-a-rat",
        "customMarkerImage"
      );
      Object.defineProperty(picker, "value", {
        get: () => input.value,
        set: value => {
          input.value = value;
        }
      });
      picker.append(input);
      group.append(picker);
      form.append(group);
    }
    for (const [key, min, max] of [
      ["opacity", 30, 80],
      ["grayscale", 0, 100]
    ]) {
      const picker = document.createElement("range-picker");
      picker.setAttribute("name", `probably-just-a-rat.${key}`);
      const range = document.createElement("input");
      const number = document.createElement("input");
      range.type = "range";
      number.type = "number";
      for (const input of [range, number]) {
        input.min = String(min);
        input.max = String(max);
        input.step = "5";
        input.value = String(
          host.game.settings.get("probably-just-a-rat", key)
        );
        picker.append(input);
      }
      let value = Number(range.value);
      Object.defineProperty(picker, "value", {
        get: () => value,
        set: next => {
          value = Number(next);
          range.value = number.value = String(next);
          picker.dispatchEvent(new Event("input", { bubbles: true }));
          picker.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      range.addEventListener("input", () => {
        value = Number(range.value);
        number.value = range.value;
      });
      number.addEventListener("change", () => {
        picker.value = number.value;
      });
      form.append(picker);
    }
    const outline = document.createElement("input");
    outline.type = "checkbox";
    outline.name = "probably-just-a-rat.outline";
    outline.checked = host.game.settings.get("probably-just-a-rat", "outline");
    form.append(outline);
    const colorGroup = document.createElement("div");
    colorGroup.className = "form-group";
    const outlineColor = document.createElement("input");
    outlineColor.type = "color";
    outlineColor.name = "probably-just-a-rat.outlineColor";
    outlineColor.value = host.game.settings.get(
      "probably-just-a-rat",
      "outlineColor"
    );
    colorGroup.append(outlineColor);
    form.append(colorGroup);
    const save = document.createElement("button");
    save.textContent = "Save";
    save.type = "submit";
    form.append(save);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const keys = ["opacity", "grayscale", "outline", "outlineColor"];
      if (host.game.user.isGM) keys.unshift("markerStyle", "customMarkerImage");
      for (const key of keys)
        await host.game.settings.set(
          "probably-just-a-rat",
          key,
          key === "outline"
            ? outline.checked
            : form.querySelector(`[name="probably-just-a-rat.${key}"]`).value
        );
      this.closeSettings();
    });
    document.body.append(form);
    settingsWindow = { element: form };
    preview.mount(settingsWindow, form);
  },
  closeSettings() {
    if (!settingsWindow) return;
    preview.unmount(settingsWindow);
    settingsWindow.element.remove();
    settingsWindow = null;
  },
  move(x) {
    token.document.x = 999;
    token.position.x = x;
    mesh.position.x = x + 50;
    token.visible = mesh.visible = x + 50 < 260;
    tracker.schedule(token);
  },
  clear: () => tracker.clearMemory(),
  ping(altKey = false, shiftKey = false) {
    return pings.ping("enemy", {
      altKey,
      shiftKey,
      preventDefault() {},
      stopImmediatePropagation() {}
    });
  },
  add(id, x, y = 350) {
    const otherMesh = new PIXI.Sprite(texture);
    otherMesh.anchor.set(0.5);
    otherMesh.position.set(x + 50, y + 50);
    otherMesh.elevation = 0;
    otherMesh.visible = x + 50 < 260;
    const other = {
      ...token,
      visible: otherMesh.visible,
      document: { ...token.document, id, name: `Enemy ${id}` },
      mesh: otherMesh,
      position: { x, y }
    };
    other.document.object = other;
    host.canvas.tokens.placeables.push(other);
    app.stage.addChild(otherMesh);
    tracker.schedule(other);
  },
  moveToken(id, x) {
    const other = host.canvas.tokens.placeables.find(
      value => value.document.id === id
    );
    other.position.x = x;
    other.mesh.position.x = x + 50;
    other.visible = other.mesh.visible = x + 50 < 260;
    tracker.schedule(other);
  },
  async appearance(values) {
    for (const [key, value] of Object.entries(values))
      await host.game.settings.set("probably-just-a-rat", key, value);
  },
  stats: () => ({
    records: store.size,
    markers: tracker.renderer.markers.size,
    observedX: store.get("enemy")?.snapshot.x,
    images: tracker.renderer.textures.size,
    borrowedDestroyed: texture.destroyed
  }),
  dispose() {
    this.closeSettings();
    preview.dispose();
    tracker.suspend();
    pings.dispose();
  }
};
