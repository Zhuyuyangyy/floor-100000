// AG-76 — Electron main process: the desktop shell of 《第100000层：末日宿舍》.
//
// Scope discipline: this file is the SHELL only. No game logic lives here.
// Responsibilities, in order:
//   1. single instance lock;
//   2. a 1280x720 resizable window that remembers its bounds across launches;
//   3. dev mode (not packaged) loads http://127.0.0.1:5377, production loads
//      ../dist/index.html — the game itself is unchanged in both modes;
//   4. a minimal application menu plus F11 fullscreen;
//   5. the main-process half of the save bridge: localStorage writes are
//      mirrored to userData/saves.json so a Steam Cloud sync target exists
//      (see preload.cjs and README.md 「Steamworks 接入点」).
//
// Layout contract: this file ships at <app>/electron/main.cjs both when run
// from the repo (`electron .`, dev) and inside the electron-builder package
// (directories.app points at the repo root, see electron-builder.yml), so
// ../dist resolves to the vite build output in both cases.

const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Dev server port agreed with the project (agent-workbench/INTEGRATION_LOG.md:
// "服务器 5377 常驻"). vite.config.ts keeps 5173 for plain browser dev; the
// shell pins 5377 so `npx vite --port 5377` and the shell always agree.
const DEV_SERVER_URL = process.env.FLOOR_DEV_SERVER_URL || 'http://127.0.0.1:5377';
const IS_DEV = !app.isPackaged && !process.env.FLOOR_FORCE_PROD;

const MIN_WIDTH = 640;
const MIN_HEIGHT = 360;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

const WINDOW_STATE_FILE = 'window-state.json';
const SAVES_FILE = 'saves.json';

// Must stay in sync with the game's save keys (src/core/constants.ts SAVE_KEY,
// src/systems/metaProgress.ts META_KEY). Only keys with this prefix are
// mirrored to disk; anything else a page might store is left alone.
const SAVE_KEY_PREFIX = 'floor100000.';

// ---------------------------------------------------------------------------
// Window state (bounds + maximized), persisted in userData.
// ---------------------------------------------------------------------------

function windowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (state && typeof state === 'object' && !Array.isArray(state)) return state;
  } catch {
    // Missing or corrupt: defaults are fine, and a corrupt state file is not
    // worth an error dialog.
  }
  return null;
}

// A restored window must overlap at least one display's work area — a monitor
// that was unplugged since the last run would otherwise leave the game
// launched off-screen with no way to drag it back.
function isVisibleOnSomeDisplay(bounds) {
  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x + Math.min(bounds.width, area.width) > area.x &&
      bounds.x < area.x + area.width &&
      bounds.y + Math.min(bounds.height, area.height) > area.y &&
      bounds.y < area.y + area.height
    );
  });
}

// While maximized, getBounds() reports the maximized rect; store the normal
// (restore) rect instead so un-maximizing lands where the player left it.
function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(
      windowStatePath(),
      JSON.stringify({ ...bounds, isMaximized: win.isMaximized() }),
      'utf8',
    );
  } catch {
    // Best-effort: a failed state write costs the player nothing but the
    // remembered position.
  }
}

// ---------------------------------------------------------------------------
// Save bridge, main side: userData/saves.json maps localStorage keys (with the
// floor100000. prefix) to their string values. The renderer keeps using
// localStorage synchronously; this file is the durable mirror that Steam Cloud
// will sync later. Writes are atomic (tmp + rename) so a crash can never leave
// a half-written JSON behind.
// ---------------------------------------------------------------------------

function createSaveStore() {
  const file = path.join(app.getPath('userData'), SAVES_FILE);
  let cache = null;

  function readAll() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      // First run (no file yet) or corruption. On corruption, keep a backup:
      // this file may be the only copy of a run if file:// localStorage was
      // wiped. Never silently overwrite it.
      try {
        if (fs.existsSync(file)) fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // Backup failed (permissions?); starting empty is still better than
        // refusing to boot.
      }
      cache = {};
    }
    return cache;
  }

  function flush() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(readAll()), 'utf8');
    fs.renameSync(tmp, file);
  }

  return {
    readAll,
    set(key, value) {
      if (typeof key !== 'string' || !key.startsWith(SAVE_KEY_PREFIX)) return;
      if (typeof value !== 'string') return;
      readAll()[key] = value;
      flush();
    },
    remove(key) {
      if (typeof key !== 'string' || !key.startsWith(SAVE_KEY_PREFIX)) return;
      delete readAll()[key];
      flush();
    },
    clear() {
      for (const key of Object.keys(readAll())) {
        if (key.startsWith(SAVE_KEY_PREFIX)) delete readAll()[key];
      }
      flush();
    },
  };
}

// ---------------------------------------------------------------------------
// Window.
// ---------------------------------------------------------------------------

function devServerDownPage() {
  const html = [
    '<body style="background:#0b0f12;color:#c9d4d8;font-family:system-ui,sans-serif;padding:2rem;line-height:1.7">',
    '<h2 style="margin:0 0 .5rem">连不上开发服务器</h2>',
    `<p>主进程在加载 <code>${DEV_SERVER_URL}</code> 时失败。请确认仓库根目录下已运行：</p>`,
    '<p><code style="color:#7fd4b0">npx vite --port 5377</code></p>',
    '<button onclick="location.reload()" style="padding:.4rem 1rem">重试</button>',
    '</body>',
  ].join('');
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  const saved = loadWindowState();
  const restored = saved && isVisibleOnSomeDisplay(saved) ? saved : null;
  const width = Math.max(restored?.width ?? DEFAULT_WIDTH, MIN_WIDTH);
  const height = Math.max(restored?.height ?? DEFAULT_HEIGHT, MIN_HEIGHT);

  const win = new BrowserWindow({
    width,
    height,
    ...(restored && typeof restored.x === 'number' && typeof restored.y === 'number'
      ? { x: restored.x, y: restored.y }
      : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    resizable: true,
    backgroundColor: '#0b0f12',
    show: false,
    webPreferences: {
      // contextIsolation must stay OFF: the save bridge patches the page's
      // localStorage from the preload (see preload.cjs), and a patch made in
      // an isolated world only ever sees that world's calls — the game's own
      // setItem would sail past it untouched. Sharing one world is what makes
      // the mirror work. The security boundary that matters is unchanged:
      // nodeIntegration off, renderer sandboxed — the page gets no Node
      // powers, it merely shares a world with a ~100-line storage patch.
      // (contextBridge is unusable here by design: it throws unless
      // contextIsolation is on, so the bridge is a plain window global.)
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Remember bounds on every completed move/resize, and always on close (the
  // safety net for a session that never fired moved/resized).
  win.on('moved', () => saveWindowState(win));
  win.on('resized', () => saveWindowState(win));
  win.on('close', () => saveWindowState(win));

  win.once('ready-to-show', () => {
    win.show();
    if (restored?.isMaximized === true) win.maximize();
  });

  if (IS_DEV) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'bottom' });
    win.webContents.on('did-fail-load', (_event, _errorCode, _description, validatedURL) => {
      if (validatedURL === DEV_SERVER_URL) void win.loadURL(devServerDownPage());
    });
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // External links open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ---------------------------------------------------------------------------
// Minimal menu: 游戏 / 视图 / 帮助. Replaces Electron's default six-menu bar.
// ---------------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '游戏',
      submenu: isMac ? [{ role: 'quit' }] : [{ role: 'quit', label: '退出' }],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: (_item, win) => win?.webContents.reload(),
        },
        { type: 'separator' },
        {
          label: '全屏',
          accelerator: 'F11',
          click: (_item, win) => {
            if (win) win.setFullScreen(!win.isFullScreen());
          },
        },
        {
          label: '开发者工具',
          accelerator: 'F12',
          click: (_item, win) => win?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于《第100000层》',
          click: () =>
            void dialog.showMessageBox({
              type: 'info',
              title: '关于',
              message: '第100000层：末日宿舍',
              detail: `Electron ${process.versions.electron} · 桌面壳 AG-76 · appId fun.shushubiye.floor100000`,
              buttons: ['好'],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Save bridge IPC.
// ---------------------------------------------------------------------------

function wireSaveBridge(saveStore) {
  // Boot info for the preload: disk saves (hydrated before any page script
  // runs) plus environment facts for window.floorDesktop. sendSync so the
  // renderer is guaranteed a complete answer before the game reads storage.
  ipcMain.on('floor:boot', (event) => {
    event.returnValue = {
      saves: saveStore.readAll(),
      platform: process.platform,
      versions: process.versions,
      isDev: IS_DEV,
    };
  });

  // Hot path: the preload's localStorage patch fires these on every prefixed
  // write. Fire-and-forget by design — localStorage stays the synchronous
  // source of truth in-session, disk is only the mirror.
  ipcMain.on('floor:saves:set', (_event, payload) => saveStore.set(payload?.key, payload?.value));
  ipcMain.on('floor:saves:remove', (_event, payload) => saveStore.remove(payload?.key));
  ipcMain.on('floor:saves:clear', () => saveStore.clear());

  // Explicit API behind window.floorDesktop.saveBridge (README 「Steamworks
  // 接入点」): the documented hook for a future Steam RemoteStorage-backed
  // Storage, without touching game code.
  ipcMain.handle('floor:saves:read', (_event, key) =>
    typeof key === 'string' ? saveStore.readAll()[key] ?? null : null,
  );
  ipcMain.handle('floor:saves:write', (_event, key, value) => saveStore.set(key, value));
  ipcMain.handle('floor:saves:delete', (_event, key) => saveStore.remove(key));
  ipcMain.handle('floor:saves:keys', () =>
    Object.keys(saveStore.readAll()).filter((key) => key.startsWith(SAVE_KEY_PREFIX)),
  );
}

// ---------------------------------------------------------------------------
// App lifecycle. Everything is guarded by the single instance lock: the second
// launch quits immediately and focuses the first one's window instead.
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    wireSaveBridge(createSaveStore());
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
