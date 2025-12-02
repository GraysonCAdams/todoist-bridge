import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

// Load .env file
loadDotenv();

// Unified sync mapping schema - used by both Google and Alexa sources
const SyncMappingSchema = z.object({
  source_list_id: z.string(), // Google list ID or "all" for Alexa
  todoist_project_id: z.string(),
  include_completed: z.boolean().default(false),
  delete_after_sync: z.boolean().default(false),
  tags: z.array(z.string()).default([]), // Custom tags to apply to synced tasks
});

// Google Tasks source configuration
const GoogleSourceSchema = z.object({
  enabled: z.boolean().default(true),
  poll_interval_minutes: z.number().min(1).max(60).default(5),
  credentials_path: z.string().default('./credentials/google-credentials.json'),
  token_path: z.string().default('./credentials/google-token.json'),
  lists: z.array(SyncMappingSchema).default([]),
});

// Alexa Shopping List sync configuration
const AlexaShoppingListSchema = z.object({
  enabled: z.boolean().default(false),
  todoist_project_id: z.string().optional(),
  include_completed: z.boolean().default(false),
  delete_after_sync: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

// Alexa Reminders source configuration
const AlexaSourceSchema = z.object({
  enabled: z.boolean().default(false),
  poll_interval_minutes: z.number().min(2).max(60).default(5),
  cookie_path: z.string().default('./credentials/alexa-cookie.json'),
  amazon_page: z.string().default('amazon.com'),
  proxy_port: z.number().default(3001),
  proxy_host: z.string().optional(), // Host/IP for proxy redirects (auto-detected if not set)
  fail_silently: z.boolean().default(true),
  max_retries: z.number().min(1).max(10).default(3),
  lists: z.array(SyncMappingSchema).default([]),
  sync_shopping_list: AlexaShoppingListSchema.default({}),
});

const ConfigSchema = z.object({
  poll_interval_minutes: z.number().min(1).default(5),

  todoist: z.object({
    api_token: z.string(),
  }),

  sources: z.object({
    google: GoogleSourceSchema.default({}),
    alexa: AlexaSourceSchema.default({}),
  }).default({}),

  // Global sync settings (can be overridden per-list)
  sync: z.object({
    sync_completed_once: z.boolean().default(true),
  }).default({}),

  storage: z.object({
    database_path: z.string().default('./data/sync.db'),
  }).default({}),

  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type SyncMapping = z.infer<typeof SyncMappingSchema>;
export type GoogleSource = z.infer<typeof GoogleSourceSchema>;
export type AlexaSource = z.infer<typeof AlexaSourceSchema>;
export type AlexaShoppingList = z.infer<typeof AlexaShoppingListSchema>;

function loadYamlConfig(): Partial<Config> {
  const configPaths = ['config.yaml', 'config.yml'];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      return parseYaml(content) || {};
    }
  }

  return {};
}

function getEnvConfig(): Partial<Config> {
  const env: Partial<Config> = {};

  if (process.env.POLL_INTERVAL_MINUTES) {
    env.poll_interval_minutes = parseInt(process.env.POLL_INTERVAL_MINUTES, 10);
  }

  if (process.env.TODOIST_API_TOKEN) {
    env.todoist = {
      api_token: process.env.TODOIST_API_TOKEN,
    };
  }

  if (process.env.DATABASE_PATH) {
    env.storage = {
      database_path: process.env.DATABASE_PATH,
    };
  }

  if (process.env.LOG_LEVEL) {
    env.logging = {
      level: process.env.LOG_LEVEL as Config['logging']['level'],
    };
  }

  return env;
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

export function loadConfig(): Config {
  const yamlConfig = loadYamlConfig();
  const envConfig = getEnvConfig();

  // Merge: yaml < env (env takes precedence)
  const merged = deepMerge(yamlConfig as Record<string, unknown>, envConfig as Record<string, unknown>);

  // Validate and apply defaults
  const result = ConfigSchema.parse(merged);

  return result;
}
