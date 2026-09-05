/**
 * What this terminal is allowed to sync, given its store's operating mode.
 *
 * Pure on purpose. These two predicates decide whether a shop keeps or loses its local stock
 * management and whether locally-created products ever reach the server, so they are worth
 * testing directly rather than through a sync cycle that needs Electron and a database.
 *
 * Both default to today's behavior when the inputs are missing. A terminal that never activated,
 * failed to read its config, or talks to a server too old to send the fields must keep working
 * exactly as it did before this feature existed.
 */

export interface TerminalSyncConfig {
  mode?: string | null;
  posAdminLocked?: boolean | null;
}

/** False only for an OFFLINE_ONLY store, whose SQLite is the source of truth and has no server. */
export function shouldSync(config: TerminalSyncConfig | null | undefined): boolean {
  return config?.mode !== 'OFFLINE_ONLY';
}

/**
 * Whether the terminal may push master data (users, categories, suppliers, products, arrivals,
 * settings) up to the server — i.e. whether `uploadLocalData()` runs.
 *
 * Sales, closed shifts, heartbeats and logs are outside this and always upload; they are the
 * terminal's own records, not master data, and losing them would lose money.
 */
export function shouldUploadMasterData(
  role: string | null | undefined,
  config: TerminalSyncConfig | null | undefined,
): boolean {
  if (role !== 'ADMIN') return false;
  return config?.posAdminLocked !== true;
}
