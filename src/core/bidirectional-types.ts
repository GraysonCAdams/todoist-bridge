/**
 * Types for bi-directional sync engines
 * Extends the base SourceEngine to support syncing in both directions
 */

import type { SyncResult, SourceEngine } from './types.js';

/**
 * Extended sync result for bi-directional sync operations
 */
export interface BidirectionalSyncResult extends SyncResult {
  /** Number of items created in the source platform (from Todoist) */
  createdInSource: number;
  /** Number of items updated in the source platform (from Todoist) */
  updatedInSource: number;
  /** Number of items completed in the source platform (from Todoist) */
  completedInSource: number;
  /** Number of items deleted from the source platform */
  deletedFromSource: number;
}

/**
 * Conflict resolution strategies for bi-directional sync
 */
export type ConflictResolution = 'last_write_wins' | 'prefer_todoist' | 'prefer_source';

/**
 * Assignment mode for tasks synced from Todoist to a shared source list
 */
export type AssignmentMode = 'self' | 'none';

/**
 * Interface for bi-directional sync engines
 * Extends SourceEngine with capabilities to write back to the source platform
 */
export interface BidirectionalSourceEngine extends SourceEngine {
  /**
   * Perform a bi-directional sync operation
   * @returns Result including changes made in both directions
   */
  syncBidirectional(): Promise<BidirectionalSyncResult>;
}

/**
 * Create an empty bi-directional sync result
 */
export function createEmptyBidirectionalSyncResult(): BidirectionalSyncResult {
  return {
    success: true,
    created: 0,
    updated: 0,
    deleted: 0,
    completed: 0,
    deletedFromSource: 0,
    tagsUpdated: 0,
    errors: [],
    createdInSource: 0,
    updatedInSource: 0,
    completedInSource: 0,
  };
}

/**
 * Merge multiple bi-directional sync results into one
 */
export function mergeBidirectionalSyncResults(
  results: BidirectionalSyncResult[]
): BidirectionalSyncResult {
  const merged = createEmptyBidirectionalSyncResult();

  for (const result of results) {
    merged.created += result.created;
    merged.updated += result.updated;
    merged.deleted += result.deleted;
    merged.completed += result.completed;
    merged.deletedFromSource += result.deletedFromSource;
    merged.tagsUpdated += result.tagsUpdated;
    merged.errors.push(...result.errors);
    merged.createdInSource += result.createdInSource;
    merged.updatedInSource += result.updatedInSource;
    merged.completedInSource += result.completedInSource;

    if (!result.success) {
      merged.success = false;
    }
  }

  return merged;
}
