import { MODULE_ID } from "../constants.js";
import { localize } from "../localization.js";
import { sceneMemoryMode } from "../settings.js";
import { memoryRules, memoryRulesText } from "../memory-status.js";

/** Native SceneConfig flag; only the GM can enable exploration memory.
 * @param {import("../../types/foundry.js").FoundryHost} host
 * @param {any} app @param {HTMLElement} element
 */
export function addSceneMemoryOptions(host, app, element) {
  if (
    !host.game.user.isGM ||
    !app.document?.isOwner ||
    app.isEditable === false
  )
    return;
  const selector =
    '.tab[data-tab="visibility"], [data-application-part="visibility"]';
  const tab = element.matches?.(selector)
    ? element
    : element.querySelector(selector);
  if (!tab || tab.querySelector(".rat-scene-memory")) return;
  const section = host.document.createElement("fieldset");
  section.className = "rat-scene-memory";
  const legend = section.appendChild(host.document.createElement("legend"));
  legend.textContent =
    " Probably Just a Rat — " +
    localize(host, "RAT.Scene.OverlandMemory.Title");
  const icon = host.document.createElement("i");
  icon.className = "fa-solid fa-mouse-field";
  icon.setAttribute("aria-hidden", "true");
  legend.prepend(icon);
  const group = host.document.createElement("div");
  group.className = "form-group";
  section.appendChild(group);
  const label = group.appendChild(host.document.createElement("label"));
  const input = group.appendChild(host.document.createElement("select"));
  input.name = `flags.${MODULE_ID}.memoryMode`;
  input.id = `${app.id}-rat-overland-memory`;
  for (const mode of ["world", "long", "disabled"]) {
    const option = input.appendChild(host.document.createElement("option"));
    option.value = mode;
    option.textContent = localize(host, `RAT.Scene.Mode.${mode}`);
  }
  input.value = sceneMemoryMode(app.document);
  label.htmlFor = input.id;
  label.textContent = localize(host, "RAT.Scene.OverlandMemory.Name");
  const hint = group.appendChild(host.document.createElement("p"));
  hint.className = "hint";
  hint.textContent = localize(host, "RAT.Scene.OverlandMemory.Hint");
  const rules = section.appendChild(host.document.createElement("p"));
  rules.className = "hint rat-scene-effective-rules";
  rules.setAttribute("aria-live", "polite");
  const updateRules = () => {
    const mode =
      input.value === "long" || input.value === "disabled"
        ? input.value
        : "world";
    rules.textContent = memoryRulesText(host, memoryRules(host, mode)).detail;
  };
  input.addEventListener("change", updateRules);
  updateRules();
  tab.prepend(section);
}

/** Open the native sheet without discarding an already open scene form's drafts.
 * @param {import("../../types/foundry.js").FoundryHost} host
 */
export async function openCurrentSceneMemorySettings(host) {
  const scene = host.canvas?.scene;
  if (!host.game.user.isGM || !host.canvas?.ready || !scene?.isOwner)
    return false;
  const sheet = scene.sheet;
  if (!sheet || sheet.isEditable === false) return false;
  if (sheet.rendered) sheet.changeTab("visibility", "sheet");
  else await sheet.render({ force: true, tab: { sheet: "visibility" } });
  if (sheet.minimized) await sheet.maximize();
  sheet.bringToFront();
  return true;
}
