import { installModule } from "./lifecycle.js";

// All platform access is isolated at this entry boundary.
installModule(
  /** @type {import("../types/foundry.js").FoundryHost} */ (
    /** @type {unknown} */ (globalThis)
  )
);
