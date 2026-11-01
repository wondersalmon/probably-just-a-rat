# Changelog

## 0.3.0

### New

- **Daggerheart:** Added a GM choice between the existing spotlight-step limit and memory until encounter end. Settings, previews, scene summaries and marker captions use spotlight terminology; saved limits and scene Long memory remain supported.
- **Panel status and rules:** Position memory explains scene, combat and vision restrictions and shows the saved effective policy, including Daggerheart and Long memory. Status and rule changes update an open panel even when the list is empty.
- **Support report:** GMs can copy versions, rules and observation status without game documents or remembered positions, with manual copying when clipboard access fails.

### Fixes

- **See Invisibility:** Visually rediscovered invisible enemies now update memory and remove old markers, including in PF2e and Starfinder 2e. Detection and ordinary sight or illumination must overlap at the same point for the same observer; nonvisual senses still cannot update memory.

Documentation: [Module documentation](https://github.com/wondersalmon/probably-just-a-rat/blob/main/README.md) · [Changelog in Russian](https://github.com/wondersalmon/probably-just-a-rat/blob/HEAD/CHANGELOG.ru.md#030).

## 0.2.1

### New

- **Settings sample:** Added an independent appearance preview.

- **Marker styles:** The GM can choose boot prints, a hollow position pin or a custom image for all players, with a local preview. Custom artwork uses Foundry's native file picker and supports aspect-ratio fitting, appearance effects and a safe fallback.
- **Rotate with movement:** An always-visible GM setting enables movement rotation for ghosts, boot prints, position pins and custom images. Off by default; the angle freezes after loss of sight.
- **Overland map memory:** A GM scene option keeps known positions through Hidden, elapsed time and combat changes until rediscovery or manual removal. Token vision and context isolation still apply.
- **Keep positions on Hidden:** A GM option retains already known positions when a token is hidden; the default still clears memory.

### Changes and improvements

- **Settings organization:** Grouped marker, memory, captions and personal appearance; clarified names, GM Hidden behavior, activity choices and three scene modes with effective rules.

- **Scene settings:** Moved the overland scene option into a visible module block at the top of the visibility tab.
- **Marker appearance:** Applied grayscale to procedural markers, strengthened boot-print outlines and renamed shared appearance settings from ghost to marker.
- **Combat captions:** Kept the last-position caption visible alongside the combat round counter.

### Fixes

- **Memory rules:** Reject invalid lifetimes before saving; preserve long memory across scene and vision-source departures in bounded, isolated local checkpoints.

- **Last visible step:** Capture visually confirmed native position refreshes before queued observation can coalesce them, preserving the last visible step and footprint heading during long moves.
- **Timer failures:** Stop observation and release the interval after a timer-render failure to prevent repeated errors.
- **Early startup:** Restored module settings and controls when Foundry's release information is not yet available.

Documentation: [Module documentation](https://github.com/wondersalmon/probably-just-a-rat/blob/main/README.md) · [Changelog in Russian](https://github.com/wondersalmon/probably-just-a-rat/blob/HEAD/CHANGELOG.ru.md#021).

## 0.1.1

### New

- **Manual release builds:** Added GitHub release builds from an existing tag, with tag and package-version validation.

### Changes and improvements

- **Development dependencies:** Updated dependencies, kept Pixi 7 and disabled its automatic major updates.

Documentation: [Module documentation](https://github.com/wondersalmon/probably-just-a-rat/blob/main/README.md) · [Changelog in Russian](https://github.com/wondersalmon/probably-just-a-rat/blob/HEAD/CHANGELOG.ru.md#011).

## 0.1.0

### New

- **First public release:** Last-seen enemy ghosts for Foundry VTT 14.
- **Client-local memory:** Ghosts stay at last-seen enemy positions, return after F5 and disappear on rediscovery or expiry.
- **Remembered-position controls:** Added a token-tool panel and combat-tracker pings, with optional Adventurer HUD integration.
- **Appearance and GM rules:** Personal opacity, grayscale, outline and caption settings; GM rules for names, round counters, ping audience and combat-only mode.
- **Token overrides and localization:** Per-token overrides, a clear-memory keybinding and English/Russian localization.
- **Memory lifetime:** GM-configurable expiry, defaulting to 2 combat rounds and 1 minute outside combat.

Documentation: [Module documentation](https://github.com/wondersalmon/probably-just-a-rat/blob/main/README.md) · [Changelog in Russian](https://github.com/wondersalmon/probably-just-a-rat/blob/HEAD/CHANGELOG.ru.md#010).
