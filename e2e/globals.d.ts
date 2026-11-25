// Shared typings for the dev-only Playwright handles.
//
// Declared in exactly one place: two spec files augmenting Window with their own
// State shapes is a TS2717 conflict, because every spec lands in the same
// program. Keep this permissive — the specs narrow it themselves where they need
// to, and a browser callback that reads `window.__PHASER_SESSION__` bare works
// without an inline cast, which matters because the callback is serialized and a
// cast is not always stripped first.

interface E2EGameState {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  status: string;
  player: {
    x: number;
    hp: number;
    hunger: number;
    thirst: number;
    energy: number;
    stress?: number;
    homeUpgrades: string[];
    inventory: { slotCount: number; slots: Array<{ itemId: string; quantity: number }> };
  };
  diary?: Array<{ kind: string; message: string }>;
  shelterPlan?: { action: string; resolved: boolean };
  visitedFloors: Record<string, { openedContainers: string[]; lootedItems: string[] }>;
  worldEvents: {
    history: string[];
    activeEvent: unknown;
    dwell?: { floor: number; minutes: number; nextRollAt: number; rolls: number };
  };
  [key: string]: unknown;
}

declare global {
  interface Window {
    __PHASER_GAME__?: {
      scene: {
        scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }>;
        getScenes: (r?: boolean) => Array<{ scene: { key: string } }>;
        getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number }> } } | null;
      };
      loop: {
        stop: () => void;
      };
    };
    __PHASER_SESSION__?: { getState: () => E2EGameState | null };
    /**
     * 生产构建（`?debug=1`）下唯一的**写**通道。
     *
     * dev 包的 __PHASER_SESSION__ 直接返回活对象，读和写都能做；生产包的
     * getState() 返回深拷贝快照，写它不会回写游戏。e2e-live 需要「瞬移到
     * 楼梯口」这类夹具，所以走这个语义显式的入口，避免把「读状态」和
     * 「改进程内状态」混在同一个名字下。
     */
    __PHASER_TEST_MUTATE__?: (mutator: (state: E2EGameState) => void) => void;
    __PHASER_TOWER__?: unknown;
  }
}

export type { E2EGameState };
