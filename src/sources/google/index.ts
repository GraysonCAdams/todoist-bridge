/**
 * Google Tasks Source
 *
 * Syncs tasks from Google Tasks to Todoist.
 *
 * Rate Limits:
 * - Google Tasks API: 50,000 queries/day (~35/min sustained)
 * - Recommended minimum poll interval: 1 minute
 * - Default poll interval: 5 minutes
 */

export { GoogleTasksSource } from './source.js';
export { GoogleAuth } from './auth.js';
export { GoogleTasksClient } from './client.js';
export type { GoogleTask, GoogleTaskList } from './client.js';
export type { GoogleSourceConfig } from './types.js';
