const KEY = 'pdf-editor-ui-preferences-v1';
export const DEFAULT_UI_PREFS = Object.freeze({
  toolbarPosition: 'right',
  compactMode: true,
  toolsCollapsed: false
});

export function normalizeUiPreferences(value = {}) {
  const pos = ['top','left','right'].includes(value?.toolbarPosition) ? value.toolbarPosition : DEFAULT_UI_PREFS.toolbarPosition;
  return {
    toolbarPosition: pos,
    compactMode: typeof value?.compactMode === 'boolean' ? value.compactMode : DEFAULT_UI_PREFS.compactMode,
    toolsCollapsed: typeof value?.toolsCollapsed === 'boolean' ? value.toolsCollapsed : DEFAULT_UI_PREFS.toolsCollapsed
  };
}

export function loadUiPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(KEY);
    return normalizeUiPreferences(raw ? JSON.parse(raw) : DEFAULT_UI_PREFS);
  } catch {
    return {...DEFAULT_UI_PREFS};
  }
}

export function saveUiPreferences(value, storage = globalThis.localStorage) {
  const normalized = normalizeUiPreferences(value);
  try { storage?.setItem?.(KEY, JSON.stringify(normalized)); } catch {}
  return normalized;
}
