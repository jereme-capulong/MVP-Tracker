# History Exclusions

This file documents the action exclusions currently enforced in MVP Tracker history pipelines, and how to remove them if you are moving to a brand-new database.

## Excluded Actions

The following history actions are currently excluded:

- `Reset Timer Now`
- `Reset History Now`

## Where Exclusions Are Applied

### Renderer (History View + Local History Cache)

File: `renderer/src/App.tsx`

- `EXCLUDED_HISTORY_ACTIONS` defines excluded actions.
- `isExcludedHistoryAction(...)` checks whether an action is excluded.
- `normalizeFirestoreHistoryEntry(...)` returns `null` for excluded actions, so they never enter the in-memory history list.
- `normalizePersistedHistoryLocalCacheRecord(...)` removes excluded entries from restored cache and adjusts cached totals.
- `mergeFetchedHistoryEntriesIntoLocalCache(...)` filters excluded actions before merging into local cache.
- `replaceHistoryLocalCacheEntries(...)` filters excluded actions before replacing local cache.
- `appendMonsterHistoryEntries(...)` skips writing excluded actions to Firestore.

### Electron DuckDB (Derived Analytics Cache)

File: `electron/historyLocalCacheDuckDb.ts`

- `EXCLUDED_HISTORY_ACTION_NORMS` defines excluded action names (normalized to lowercase).
- `normalizeHistoryActionForAnalytics(...)` drops excluded actions (returns empty norm).
- `deleteExcludedHistoryAnalyticsRows(...)` deletes already-synced excluded rows from `history_analytics_tracks`.
- `syncHistoryAnalyticsTracksFromCache(...)` runs exclusion cleanup before upserting analytics rows.

## How To Remove Exclusions (New Database Scenario)

If you are starting with a brand-new Firestore database and a brand-new local DuckDB cache, and you want these actions included again:

1. Update `renderer/src/App.tsx`:
   - Remove `EXCLUDED_HISTORY_ACTIONS`.
   - Remove `isExcludedHistoryAction(...)`.
   - In `normalizeFirestoreHistoryEntry(...)`, change:
     - from: `if (!action || isExcludedHistoryAction(action)) return null;`
     - to: `if (!action) return null;`
   - In `normalizePersistedHistoryLocalCacheRecord(...)`, remove excluded-entry filtering logic and total-entry adjustment for excluded entries.
   - In `mergeFetchedHistoryEntriesIntoLocalCache(...)`, remove the `filteredEntries` step and merge `entries` directly.
   - In `replaceHistoryLocalCacheEntries(...)`, remove the `filteredEntries` step and dedupe from `entries` directly.
   - In `appendMonsterHistoryEntries(...)`, remove `isExcludedHistoryAction(action)` from the skip condition.

2. Update `electron/historyLocalCacheDuckDb.ts`:
   - Remove `EXCLUDED_HISTORY_ACTION_NORMS`.
   - In `normalizeHistoryActionForAnalytics(...)`, stop excluding those actions (return normalized action string directly).
   - Remove `deleteExcludedHistoryAnalyticsRows(...)`.
   - Remove the call to `deleteExcludedHistoryAnalyticsRows(...)` inside `syncHistoryAnalyticsTracksFromCache(...)`.

3. Rebuild and restart:
   - Run `npm run typecheck`.
   - Restart the app.

## Important Note

If your Firestore is new but your local DuckDB file is old, legacy filtered rows may still affect local analytics until the local cache file is reset. For a fully clean start, use a fresh Firestore dataset and a fresh local DuckDB file.

