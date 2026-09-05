import { create } from 'zustand';

export type StoreMode = 'OFFLINE_ONLY' | 'ONLINE';

interface ModeState {
  /** null until hydrated, or when the terminal has never been activated against a server. */
  mode: StoreMode | null;
  /** When true, the Electron app is restricted to cashier operation and admin lives on the web. */
  posAdminLocked: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  applyUpdate: (update: { mode?: StoreMode; posAdminLocked?: boolean }) => void;
}

/**
 * The terminal's cached operating mode, read once from LocalConfig at startup and refreshed when
 * a sync cycle pulls a change.
 *
 * Every default here is the permissive one on purpose. A terminal that cannot read its config —
 * IPC not ready, a failed query, a never-activated install — must behave exactly as it always
 * has rather than silently lock a shop out of its own stock management.
 */
export const useModeStore = create<ModeState>()((set) => ({
  mode: null,
  posAdminLocked: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const config = await window.electronAPI.config.getLocalConfig();
      set({
        mode: config?.mode ?? null,
        posAdminLocked: config?.posAdminLocked === true,
        hydrated: true,
      });
    } catch {
      // Stay unrestricted — see note above.
      set({ hydrated: true });
    }
  },

  applyUpdate: (update) =>
    set((state) => ({
      mode: update.mode ?? state.mode,
      posAdminLocked:
        update.posAdminLocked !== undefined ? update.posAdminLocked : state.posAdminLocked,
    })),
}));
