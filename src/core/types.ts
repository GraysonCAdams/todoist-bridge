/**
 * Core types for Todoist Bridge
 * All sources must implement these interfaces for consistent integration
 */

import type { Logger } from '../utils/logger.js';
import type { Storage } from '../storage.js';
import type { TodoistClient } from '../clients/todoist.js';

/**
 * Rate limit information for API sources
 *
 * Known limits:
 * - Google Tasks API: 50,000 queries/day (~35/min sustained)
 * - Todoist API: 1,000 requests/15 min (~67/min), max 450/min burst
 * - Alexa (unofficial): No documented limits, recommend conservative polling
 */
export const RATE_LIMITS = {
  /** Minimum polling interval in minutes for each source */
  MIN_POLL_INTERVAL: {
    google: 1,      // Google has generous limits
    alexa: 2,       // Unofficial API, be conservative
    todoist: 1,     // Todoist has good limits
  },
  /** Default polling interval in minutes for each source */
  DEFAULT_POLL_INTERVAL: {
    google: 5,
    alexa: 5,
    todoist: 5,
  },
  /** Maximum recommended polling interval */
  MAX_POLL_INTERVAL: 60,
} as const;

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Whether the sync completed without fatal errors */
  success: boolean;
  /** Number of items created in Todoist */
  created: number;
  /** Number of items updated in Todoist */
  updated: number;
  /** Number of items deleted from Todoist */
  deleted: number;
  /** Number of items completed in Todoist */
  completed: number;
  /** Number of items deleted from source after sync */
  deletedFromSource: number;
  /** Number of items with updated tags */
  tagsUpdated: number;
  /** List of error messages */
  errors: string[];
}

/**
 * Configuration for a sync mapping
 */
export interface SourceMapping {
  /** Identifier for the source list/category */
  source_list_id: string;
  /** Target Todoist project ID or "inbox" */
  todoist_project_id: string;
  /** Include completed items */
  include_completed: boolean;
  /** Delete from source after syncing to Todoist */
  delete_after_sync: boolean;
  /** Tags to apply to synced tasks */
  tags: string[];
}

/**
 * Base interface that all source sync engines must implement
 */
export interface SourceEngine {
  /** Unique identifier for this source (e.g., "google", "alexa-reminders") */
  readonly sourceId: string;

  /** Human-readable name for this source */
  readonly sourceName: string;

  /**
   * Perform a sync operation
   * @returns Result of the sync operation
   */
  sync(): Promise<SyncResult>;

  /**
   * Check if the source is healthy and can perform syncs
   * @returns true if healthy, false otherwise
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Context provided to source engines during initialization
 */
export interface SourceContext {
  logger: Logger;
  storage: Storage;
  todoistClient: TodoistClient;
}

/**
 * Factory function type for creating source engines
 */
export type SourceFactory<TConfig> = (
  config: TConfig,
  context: SourceContext
) => Promise<SourceEngine | null>;

/**
 * Metadata about a registered source
 */
export interface SourceMetadata {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the source */
  description: string;
  /** Whether this source is enabled */
  enabled: boolean;
  /** Polling interval for this source */
  pollIntervalMinutes: number;
}

/**
 * Create an empty sync result
 */
export function createEmptySyncResult(): SyncResult {
  return {
    success: true,
    created: 0,
    updated: 0,
    deleted: 0,
    completed: 0,
    deletedFromSource: 0,
    tagsUpdated: 0,
    errors: [],
  };
}

/**
 * Merge multiple sync results into one
 */
export function mergeSyncResults(results: SyncResult[]): SyncResult {
  const merged = createEmptySyncResult();

  for (const result of results) {
    merged.created += result.created;
    merged.updated += result.updated;
    merged.deleted += result.deleted;
    merged.completed += result.completed;
    merged.deletedFromSource += result.deletedFromSource;
    merged.tagsUpdated += result.tagsUpdated;
    merged.errors.push(...result.errors);

    if (!result.success) {
      merged.success = false;
    }
  }

  return merged;
}

/**
 * Compare two tag arrays for equality (order-independent)
 */
export function tagsEqual(tags1: string[], tags2: string[]): boolean {
  if (tags1.length !== tags2.length) return false;
  const sorted1 = [...tags1].sort();
  const sorted2 = [...tags2].sort();
  return sorted1.every((tag, i) => tag === sorted2[i]);
}

/**
 * Parse stored tags JSON string to array
 */
export function parseStoredTags(storedTags: string | null): string[] {
  if (!storedTags) return [];
  try {
    return JSON.parse(storedTags);
  } catch {
    return [];
  }
}

/**
 * Validate and clamp a polling interval to acceptable bounds
 */
export function validatePollInterval(
  interval: number | undefined,
  sourceType: keyof typeof RATE_LIMITS.MIN_POLL_INTERVAL
): number {
  const min = RATE_LIMITS.MIN_POLL_INTERVAL[sourceType];
  const max = RATE_LIMITS.MAX_POLL_INTERVAL;
  const defaultVal = RATE_LIMITS.DEFAULT_POLL_INTERVAL[sourceType];

  if (interval === undefined || isNaN(interval)) {
    return defaultVal;
  }

  if (interval < min) {
    return min;
  }

  if (interval > max) {
    return max;
  }

  return interval;
}
