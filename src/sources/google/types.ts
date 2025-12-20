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

  // OAuth configuration for production deployments
  /**
   * Use my.home-assistant.io as OAuth redirect proxy (recommended for Home Assistant addons).
   * When enabled, Google redirects to my.home-assistant.io which forwards to your server.
   * You must configure your server URL at https://my.home-assistant.io first.
   */
  use_homeassistant_redirect: z.boolean().default(false),
  /**
   * Public OAuth redirect URL (e.g., https://myserver.example.com/oauth/google/callback)
   * Only used when use_homeassistant_redirect is false.
   */
  oauth_redirect_url: z.string().optional(),
  /**
   * Port for internal OAuth callback server
   * This is the port the app listens on internally (may differ from public port behind reverse proxy)
   */
  oauth_port: z.number().default(3000),
  /**
   * OAuth callback path that Google redirects to (only used when use_homeassistant_redirect is false)
   */
  oauth_callback_path: z.string().default('/oauth/google/callback'),
});

export type GoogleSourceConfig = z.infer<typeof GoogleSourceConfigSchema>;
