// Small boundary contract; these are not complete Foundry declarations.
export interface SettingsService {
  sheet?: any;
  register(
    namespace: string,
    key: string,
    config: {
      name: string;
      hint: string;
      scope: "world" | "client";
      config: boolean;
      type:
        | BooleanConstructor
        | NumberConstructor
        | StringConstructor
        | { toInput: (...args: any[]) => any };
      default: boolean | number | string;
      choices?: Record<string, string>;
      range?: { min: number; max: number; step: number };
      onChange: () => void;
    }
  ): void;
  get(namespace: string, key: string): unknown;
  set(namespace: string, key: string, value: unknown): Promise<unknown>;
}
export interface HookService {
  once(event: string, callback: (...args: any[]) => void): number;
  on(event: string, callback: (...args: any[]) => void): number;
  off(event: string, id: number): void;
}
export interface FoundryHost {
  // Native handles stay opaque; internal snapshots/state have strict contracts.
  canvas: any;
  PIXI: any;
  CONST: any;
  CONFIG: any;
  foundry?: any;
  document: Document;
  localStorage?: Storage;
  addEventListener?: typeof window.addEventListener;
  removeEventListener?: typeof window.removeEventListener;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  Hooks: HookService;
  game: {
    world?: { id: string };
    release: { generation: number };
    user: any;
    combat: any;
    keyboard?: { isModifierActive(key: string): boolean };
    i18n: {
      localize(key: string): string;
      format(key: string, data: Record<string, unknown>): string;
    };
    settings: SettingsService;
    modules: Map<
      string,
      {
        api?: Readonly<{
          stage: string;
          getDiagnostics?: () => unknown;
          startDiagnostics?: () => unknown;
          stopDiagnostics?: () => unknown;
          clearMemory: () => void;
          memory?: ReturnType<
            typeof import("../scripts/memory-api.js").createMemoryAPI
          >["api"];
        }>;
      }
    >;
    keybindings: {
      register(
        namespace: string,
        action: string,
        config: {
          name: string;
          hint: string;
          editable: never[];
          onDown: () => boolean;
          restricted: boolean;
        }
      ): void;
    };
  };
  ui: {
    controls?: any;
    combat?: any;
    notifications: { warn(message: string): void };
  };
}
