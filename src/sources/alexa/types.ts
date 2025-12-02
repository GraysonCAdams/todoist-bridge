/**
 * Alexa Source Type Definitions
 */

import { z } from 'zod';

/**
 * Alexa list/reminder mapping configuration
 */
export const AlexaMappingSchema = z.object({
  source_list_id: z.string(), // "all" for reminders
  todoist_project_id: z.string(),
  include_completed: z.boolean().default(false),
  delete_after_sync: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

export type AlexaMapping = z.infer<typeof AlexaMappingSchema>;

/**
 * Alexa shopping list sync configuration
 */
export const AlexaShoppingListConfigSchema = z.object({
  enabled: z.boolean().default(false),
  todoist_project_id: z.string().optional(),
  include_completed: z.boolean().default(false),
  delete_after_sync: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

export type AlexaShoppingListConfig = z.infer<typeof AlexaShoppingListConfigSchema>;

/**
 * Alexa source configuration
 */
export const AlexaSourceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  poll_interval_minutes: z.number().min(2).max(60).default(5),
  cookie_path: z.string().default('./credentials/alexa-cookie.json'),
  amazon_page: z.string().default('amazon.com'),
  proxy_port: z.number().default(3001),
  fail_silently: z.boolean().default(true),
  max_retries: z.number().min(1).max(10).default(3),
  lists: z.array(AlexaMappingSchema).default([]),
  sync_shopping_list: AlexaShoppingListConfigSchema.default({}),
});

export type AlexaSourceConfig = z.infer<typeof AlexaSourceConfigSchema>;
