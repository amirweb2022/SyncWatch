import { normalizeDisplayName } from "./code";

const DISPLAY_NAME_KEY = "syncwatch.displayName";

export interface DisplayNamePreference {
  load(): string;
  save(value: string): void;
}

export function createDisplayNamePreference(getStorage: () => Storage = () => window.localStorage): DisplayNamePreference {
  return {
    load() {
      try {
        const value = getStorage().getItem(DISPLAY_NAME_KEY) ?? "";
        const normalized = normalizeDisplayName(value);
        return normalized.valid ? normalized.name : "";
      } catch {
        return "";
      }
    },
    save(value) {
      const normalized = normalizeDisplayName(value);
      if (!normalized.valid) return;
      try {
        getStorage().setItem(DISPLAY_NAME_KEY, normalized.name);
      } catch {
        // Storage can be disabled by the browser; joining remains available.
      }
    },
  };
}
