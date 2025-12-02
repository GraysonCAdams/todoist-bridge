/**
 * Google Tasks Source Configuration Types
 */

import { z } from 'zod';

/**
 * Sync mapping for a Google Task List
 */
export const GoogleListMappingSchema = z.object({
  /** Google Task List ID */
  source_list_id: z.string(),
  /** Target Todoist project ID or "inbox" */
  todoist_project_id: z.string(),
  /** Include completed tasks */
  include_completed: z.boolean().default(false),
  /** Delete from Google after syncing to Todoist */
  delete_after_sync: z.boolean().default(false),
  /** Tags to apply to synced tasks */
  tags: z.array(z.string()).default([]),
});

export type GoogleListMapping = z.infer<typeof GoogleListMappingSchema>;

/**
 * Google Tasks source configuration
 */
export const GoogleSourceConfigSchema = z.object({
  /** Enable/disable this source */
  enabled: z.boolean().default(false),
  /** Path to OAuth credentials JSON */
  credentials_path: z.string().default('./credentials/google-credentials.json'),
  /** Path to store OAuth tokens */
  token_path: z.string().default('./credentials/google-token.json'),
  /** Polling interval in minutes (1-60) */
  poll_interval_minutes: z.number().min(1).max(60).default(5),
  /** List mappings */
  lists: z.array(GoogleListMappingSchema).default([]),
});

export type GoogleSourceConfig = z.infer<typeof GoogleSourceConfigSchema>;
