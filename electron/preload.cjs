// AG-76 — preload: the renderer half of the save bridge (runs sandboxed).
//
// Shares one JS world with the page (main.cjs keeps contextIsolation off on
// purpose): patching the page's localStorage is only possible from that
// world, and the whole design is "game code unchanged".
//
// The goal is zero game-code change. The game keeps calling SaveSystem /
// metaProgress / session, which read and write localStorage under the keys
// 'floor100000.save.v1' and 'floor100000.meta.v1'. On the desktop build this
// file makes those writes durable:
//
//   1. Hydrate (boot, synchronous): pull userData/saves.json from the main
//      process via sendSync and fill any key localStorage is missing. Because
//      preload runs before page scripts, the game's first read of a save is
//      guaranteed to see the hydrated state. This also covers the file://
//      origin, where localStorage persistence is not something to rely on.
//   2. Mirror (hot path): shadow localStorage's setItem/removeItem/clear on
//      the instance and forward prefixed writes to the main process, which
//      atomically rewrites saves.json. In-session localStorage remains the
//      synchronous source of truth; the file is the durable mirror — the file
//      Steam Cloud will sync (README 「Steamworks 接入点」).
//
// Browser impact: this preload only exists in the desktop shell. Without it
// there is no window.floorDesktop and no patch — storage behaviour is
// byte-for-byte the same as on the live web build.

const { ipcRenderer } = require('electron');

// Same prefix as main.cjs; only these keys are mirrored.
const SAVE_KEY_PREFIX = 'floor100000.';

let boot = {};
try {
  boot = ipcRenderer.sendSync('floor:boot') || {};
} catch {
  // Main unreachable (should not happen — preload runs after whenReady).
  // Fall through: the game runs on plain localStorage, saves stay in-session.
}

// --- 1. hydration -----------------------------------------------------------
// Only fill keys localStorage does not have: anything already present was
// written by this session and is newer than the file.
let hydrating = true;
const diskSaves = boot.saves && typeof boot.saves === 'object' ? boot.saves : {};
const storage = window.localStorage;
for (const [key, value] of Object.entries(diskSaves)) {
  if (typeof value !== 'string') continue;
  try {
    if (storage.getItem(key) === null) storage.setItem(key, value);
  } catch {
    // Quota or a hostile storage: keep going, the other keys still hydrate.
  }
}
hydrating = false;

// --- 2. mirror --------------------------------------------------------------
// Shadow the instance's methods (they live on Storage.prototype) so the patch
// is scoped to this origin's localStorage and the native behaviour — including
// throwing on quota — is preserved exactly.
const nativeSetItem = storage.setItem.bind(storage);
const nativeRemoveItem = storage.removeItem.bind(storage);
const nativeClear = storage.clear.bind(storage);

storage.setItem = function patchedSetItem(key, value) {
  nativeSetItem(key, value);
  if (!hydrating && typeof key === 'string' && key.startsWith(SAVE_KEY_PREFIX)) {
    ipcRenderer.send('floor:saves:set', { key, value: String(value) });
  }
};

storage.removeItem = function patchedRemoveItem(key) {
  nativeRemoveItem(key);
  if (typeof key === 'string' && key.startsWith(SAVE_KEY_PREFIX)) {
    ipcRenderer.send('floor:saves:remove', { key });
  }
};

storage.clear = function patchedClear() {
  nativeClear();
  ipcRenderer.send('floor:saves:clear');
};

// --- explicit API -----------------------------------------------------------
// The documented integration point: a future Steam RemoteStorage-backed
// Storage (or any other desktop-only feature) can be built on these without
// touching SaveSystem. Absent in the browser — feature-detect on
// window.floorDesktop.
//
// Plain window global, not contextBridge: the bridge requires
// contextIsolation, which is off here on purpose (see the header comment) —
// contextBridge throws "can only be used when contextIsolation is enabled".
// The page therefore sees this object directly; the security boundary that
// matters is still no-Node-in-the-page (nodeIntegration off, sandbox on).
window.floorDesktop = {
  isDesktop: true,
  isDev: boot.isDev === true,
  platform: typeof boot.platform === 'string' ? boot.platform : 'unknown',
  versions: boot.versions && typeof boot.versions === 'object' ? boot.versions : {},
  saveBridge: {
    // All async (IPC). Values are strings, matching localStorage semantics.
    read: (key) => ipcRenderer.invoke('floor:saves:read', key),
    write: (key, value) => ipcRenderer.invoke('floor:saves:write', key, value),
    remove: (key) => ipcRenderer.invoke('floor:saves:delete', key),
    keys: () => ipcRenderer.invoke('floor:saves:keys'),
  },
};
