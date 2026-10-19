// Reduced native boundary fixture. It deliberately does not simulate Foundry LOS.
import { Matrix, Transform } from "pixi.js";

export function runtimeHost() {
  const listeners = new Map();
  const settings = new Map();
  const menus = new Map();
  const bindings = new Map();
  const timers = new Map();
  const warnings = [];
  const frames = new Map();
  let nextId = 0;
  const add = (event, fn, once) => {
    const id = ++nextId;
    listeners.set(id, { event, fn, once });
    return id;
  };
  class Point {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y = x) {
      this.x = x;
      this.y = y;
    }
  }
  class Container {
    children = [];
    position = new Point();
    scale = new Point(1, 1);
    anchor = new Point();
    destroyed = false;
    addChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    addChildAt(child, index) {
      child.parent = this;
      this.children.splice(index, 0, child);
      return child;
    }
    toLocal(point) {
      return point;
    }
    destroy(options) {
      this.destroyed = true;
      this.destroyOptions = options;
      if (options?.children)
        for (const child of [...this.children]) child.destroy(options);
      if (this.parent)
        this.parent.children = this.parent.children.filter(
          child => child !== this
        );
    }
  }
  class Graphics extends Container {
    clear() {
      return this;
    }
    beginFill() {
      return this;
    }
    endFill() {
      return this;
    }
    drawRect() {
      return this;
    }
    drawRoundedRect() {
      return this;
    }
    drawEllipse() {
      return this;
    }
    lineStyle() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    bezierCurveTo() {
      return this;
    }
    beginHole() {
      return this;
    }
    endHole() {
      return this;
    }
  }
  class Sprite extends Container {
    constructor(texture) {
      super();
      this.texture = texture;
    }
  }
  class Text extends Container {
    constructor(text, style) {
      super();
      this.text = text;
      this.style = style;
    }
  }
  class ApplicationV2 {
    render() {
      this.rendered = true;
      return this;
    }
    close() {
      this.rendered = false;
    }
  }
  class Filter {
    constructor(_vertex, _fragment, uniforms) {
      this.uniforms = uniforms;
    }
    destroyed = false;
    saturate(amount) {
      this.monochrome = amount === -1;
      this.amount = amount;
    }
    tint(color, multiply) {
      this.tintColor = color;
      this.tintMultiplied = multiply;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const host = {
    Hooks: {
      once: (event, fn) => add(event, fn, true),
      on: (event, fn) => add(event, fn, false),
      off: (_event, id) => listeners.delete(id)
    },
    PIXI: {
      Container,
      Sprite,
      Graphics,
      Text,
      Point,
      Matrix,
      Transform,
      RenderTexture: {
        create: options =>
          host.canvas.app.renderer.generateTexture(null, options)
      },
      Filter,
      BlurFilter: Filter,
      ColorMatrixFilter: Filter,
      UPDATE_PRIORITY: { NORMAL: 0 }
    },
    CONST: { TOKEN_DISPOSITIONS: { HOSTILE: -1, SECRET: -2 } },
    foundry: { applications: { api: { ApplicationV2 } } },
    setInterval: fn => {
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearInterval: id => timers.delete(id),
    document: {},
    canvas: {
      ready: true,
      stage: { scale: { x: 1.25 } },
      scene: { id: "scene" },
      level: { id: "floor" },
      visibility: {
        tokenVision: true,
        _createVisibilityTestConfig: (points, options) => ({
          tests: points.map(point => ({ point, los: new Map() })),
          object: options.object,
          level: "floor"
        })
      },
      dimensions: {
        rect: { x: 0, y: 0, width: 2000, height: 2000 },
        sceneRect: {
          contains: (x, y) => x >= 0 && x < 2000 && y >= 0 && y < 2000
        }
      },
      interface: new Container(),
      tokens: { placeables: [] },
      effects: { visionSources: new Map() },
      app: {
        ticker: {
          add: (fn, context, priority) =>
            frames.set(fn, { context, priority, once: false }),
          addOnce: (fn, context, priority) =>
            frames.set(fn, { context, priority, once: true }),
          remove: fn => frames.delete(fn)
        },
        renderer: {
          render: () => {},
          generateTexture: () => ({
            destroyed: false,
            destroy() {
              this.destroyed = true;
            }
          })
        }
      }
    },
    game: {
      release: { generation: 14 },
      user: {
        id: "player",
        role: 1,
        isGM: false,
        can: () => true,
        hasPermission: () => true
      },
      combat: null,
      modules: new Map([["probably-just-a-rat", {}]]),
      settings: {
        register: (_ns, key, config) =>
          settings.set(key, { ...config, value: config.default }),
        registerMenu: (_ns, key, config) => menus.set(key, config),
        get: (_ns, key) => settings.get(key)?.value,
        set: async (_ns, key, value) => {
          const setting = settings.get(key);
          setting.value = value;
          setting.onChange();
        }
      },
      keybindings: {
        register: (_ns, key, config) => bindings.set(key, config)
      },
      i18n: {
        localize: key => key,
        format: (key, data) => `${key} ${Object.values(data).join(" ")}`
      }
    },
    CONFIG: {
      Canvas: {
        pings: { types: { PULSE: "pulse", ALERT: "alert", PULL: "pull" } },
        detectionModes: {
          basicSight: {
            testVisibility: (_source, mode, config) =>
              mode.enabled && config.object.visual === true
          },
          lightPerception: {
            testVisibility: (_source, mode, config) =>
              mode.enabled && config.object.lightVisual === true
          }
        }
      }
    },
    ui: { notifications: { warn: message => warnings.push(message) } }
  };
  const observer = token(host, "hero");
  observer.actor = { testUserPermission: () => observer.allowed };
  observer.allowed = true;
  observer.document.isOwner = true;
  observer.document.disposition = 1;
  observer.document.detectionModes = {
    basicSight: { enabled: true },
    lightPerception: { enabled: true },
    hearing: { enabled: true }
  };
  const source = {
    active: true,
    object: observer,
    isPreview: false,
    isBlinded: false,
    x: 100,
    y: 100,
    visionMode: { id: "basic" }
  };
  host.canvas.effects.visionSources.set("hero-source", source);
  const emit = (event, ...args) => {
    for (const [id, listener] of [...listeners])
      if (listener.event === event) {
        if (listener.once) listeners.delete(id);
        listener.fn(...args);
      }
  };
  const frame = () => {
    const batch = [...frames];
    for (const [fn, options] of batch.sort(
      (a, b) => b[1].priority - a[1].priority
    ))
      if (frames.has(fn)) {
        if (options.once) frames.delete(fn);
        fn.call(options.context);
      }
  };
  return {
    host,
    listeners,
    settings,
    menus,
    bindings,
    timers,
    warnings,
    frames,
    observer,
    source,
    emit,
    frame
  };
}

export function token(host, id = "enemy") {
  const image = { tagName: "IMG", src: "observed.webp" };
  const texture = {
    valid: true,
    width: 100,
    height: 100,
    baseTexture: { resource: { source: image } },
    destroyed: false,
    destroy() {
      this.destroyed = true;
    }
  };
  const document = {
    name: "Known enemy",
    id,
    parent: { id: "scene" },
    level: "floor",
    hidden: false,
    disposition: -1,
    isOwner: false,
    x: 999,
    y: 999,
    texture: { src: "unrendered.webp" },
    getFlag() {
      return this.override;
    },
    getVisibilityTestPoints(position) {
      this.lastTestPosition = position;
      return [
        {
          x: position.x + 50,
          y: position.y + 50,
          elevation: position.elevation
        }
      ];
    }
  };
  const value = {
    _canViewMode: () => true,
    document,
    texture,
    visual: true,
    visible: true,
    controlled: false,
    animationContexts: new Map(),
    isPreview: false,
    isFilteredOut: false,
    position: { x: 20, y: 30 },
    w: 100,
    h: 100,
    nameplate: { visible: false, text: "Secret name" },
    mesh: {
      position: { x: 70, y: 80 },
      visible: true,
      renderable: true,
      elevation: 0,
      angle: 0,
      scale: { x: 1, y: 1 },
      width: 100,
      height: 100,
      anchor: { x: 0.5, y: 0.5 },
      getBounds: () => ({
        x: value.position.x,
        y: value.position.y,
        width: 100,
        height: 100
      })
    }
  };
  document.object = value;
  host.canvas.tokens.placeables.push(value);
  return value;
}
