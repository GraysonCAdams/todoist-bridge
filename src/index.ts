import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { Storage } from './storage.js';
import { TodoistAuth } from './auth/todoist.js';
import { TodoistClient } from './clients/todoist.js';
import { GoogleTasksSource } from './sources/google/index.js';
import { AlexaRemindersSource, AlexaShoppingSource, AlexaAuth, AlexaClient } from './sources/alexa/index.js';
import type { SourceEngine, SyncResult, SourceContext } from './core/types.js';
import { mergeSyncResults } from './core/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get package version
function getVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packagePath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const VERSION = getVersion();
const START_TIME = Date.now();

// Health status tracking
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  lastSyncAt: string | null;
  lastSyncSuccess: boolean;
  syncCount: number;
  errorCount: number;
  version: string;
}

let lastSyncAt: string | null = null;
let lastSyncSuccess = true;
let syncCount = 0;
let errorCount = 0;

export function getHealthStatus(): HealthStatus {
  return {
    status: lastSyncSuccess ? 'healthy' : 'degraded',
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    lastSyncAt,
    lastSyncSuccess,
    syncCount,
    errorCount,
    version: VERSION,
  };
}

/**
 * Source with its polling configuration
 */
interface ManagedSource {
  engine: SourceEngine;
  pollIntervalMs: number;
  lastSyncAt: number;
  timeout: NodeJS.Timeout | null;
}

async function main() {
  // Load configuration
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info({ version: VERSION }, 'Todoist Bridge starting...');

  // Initialize storage
  const storage = new Storage(config.storage.database_path);
  logger.info({ database: config.storage.database_path }, 'Database initialized');

  // Authenticate with Todoist (required for all sources)
  const todoistAuth = new TodoistAuth(config, logger);
  const isValid = await todoistAuth.validateToken();
  if (!isValid) {
    logger.error('Todoist authentication failed. Please check your API token.');
    process.exit(1);
  }
  logger.info('Todoist authentication successful');
  const todoistClient = new TodoistClient(todoistAuth.getClient(), logger);

  // Create source context
  const context: SourceContext = {
    logger,
    storage,
    todoistClient,
  };

  // Initialize sources with their polling intervals
  const managedSources: ManagedSource[] = [];

  // Initialize Google Tasks source
  if (config.sources.google.enabled && config.sources.google.lists.length > 0) {
    const googleSource = await GoogleTasksSource.create(config.sources.google, context);
    if (googleSource) {
      const pollInterval = config.sources.google.poll_interval_minutes || 5;
      managedSources.push({
        engine: googleSource,
        pollIntervalMs: pollInterval * 60 * 1000,
        lastSyncAt: 0,
        timeout: null,
      });
      logger.info({
        source: 'Google Tasks',
        pollInterval,
        listCount: config.sources.google.lists.length
      }, 'Source initialized');
    }
  } else {
    logger.info('Google Tasks source disabled or no lists configured');
  }

  // Initialize Alexa sources (share the same client to avoid multiple auth flows)
  const hasAlexaReminders = config.sources.alexa.lists.length > 0;
  const hasAlexaShopping = config.sources.alexa.sync_shopping_list.enabled &&
                           config.sources.alexa.sync_shopping_list.todoist_project_id;

  if (config.sources.alexa.enabled && (hasAlexaReminders || hasAlexaShopping)) {
    logger.info('Initializing Alexa integration...');

    try {
      // Create shared Alexa client
      const alexaAuth = new AlexaAuth(config.sources.alexa, logger);
      const alexaRemote = await alexaAuth.getAuthenticatedClient();
      const alexaClient = new AlexaClient(alexaRemote, logger);
      const alexaPollInterval = config.sources.alexa.poll_interval_minutes || 5;

      // Initialize reminders source if configured
      if (hasAlexaReminders) {
        const remindersSource = await AlexaRemindersSource.create(
          config.sources.alexa,
          context,
          alexaClient
        );
        if (remindersSource) {
          managedSources.push({
            engine: remindersSource,
            pollIntervalMs: alexaPollInterval * 60 * 1000,
            lastSyncAt: 0,
            timeout: null,
          });
          logger.info({
            source: 'Alexa Reminders',
            pollInterval: alexaPollInterval
          }, 'Source initialized');
        }
      }

      // Initialize shopping source if configured
      if (hasAlexaShopping) {
        const shoppingSource = await AlexaShoppingSource.create(
          config.sources.alexa,
          context,
          alexaClient
        );
        if (shoppingSource) {
          managedSources.push({
            engine: shoppingSource,
            pollIntervalMs: alexaPollInterval * 60 * 1000,
            lastSyncAt: 0,
            timeout: null,
          });
          logger.info({
            source: 'Alexa Shopping',
            pollInterval: alexaPollInterval
          }, 'Source initialized');
        }
      }
    } catch (error) {
      if (config.sources.alexa.fail_silently) {
        logger.error({ err: error }, 'Failed to initialize Alexa integration (continuing without it)');
      } else {
        throw error;
      }
    }
  } else {
    logger.info('Alexa integration disabled or not configured');
  }

  if (managedSources.length === 0) {
    logger.error('No sources configured. Please enable at least one source in config.yaml');
    process.exit(1);
  }

  logger.info({ sourceCount: managedSources.length }, 'All sources initialized');

  // Handle graceful shutdown
  let isShuttingDown = false;
  let shutdownTimeout: NodeJS.Timeout | null = null;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Forced shutdown requested');
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated...');

    // Clear all source timeouts
    for (const source of managedSources) {
      if (source.timeout) {
        clearTimeout(source.timeout);
      }
    }

    // Set a timeout for graceful shutdown
    shutdownTimeout = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 10000);

    try {
      // Close storage connection
      storage.close();
      logger.info('Database connection closed');

      // Clear the timeout since we're done
      if (shutdownTimeout) {
        clearTimeout(shutdownTimeout);
      }

      const health = getHealthStatus();
      logger.info({
        uptime: health.uptime,
        syncCount: health.syncCount,
        errorCount: health.errorCount,
      }, 'Shutdown complete');

      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    errorCount++;
  });

  /**
   * Sync a single source
   */
  const syncSource = async (managed: ManagedSource): Promise<SyncResult> => {
    const { engine } = managed;

    try {
      logger.debug({ source: engine.sourceName }, 'Starting sync');
      const result = await engine.sync();
      managed.lastSyncAt = Date.now();

      if (!result.success) {
        logger.warn({ source: engine.sourceName, errors: result.errors }, 'Sync completed with errors');
      } else {
        logger.debug({
          source: engine.sourceName,
          created: result.created,
          updated: result.updated,
          deleted: result.deleted,
        }, 'Sync completed');
      }

      return result;
    } catch (error) {
      logger.error({ err: error, source: engine.sourceName }, 'Sync failed');
      return {
        success: false,
        created: 0,
        updated: 0,
        deleted: 0,
        completed: 0,
        deletedFromSource: 0,
        tagsUpdated: 0,
        errors: [`${engine.sourceName}: ${error}`],
      };
    }
  };

  /**
   * Schedule next sync for a source
   */
  const scheduleSourceSync = (managed: ManagedSource) => {
    if (isShuttingDown) return;

    managed.timeout = setTimeout(async () => {
      if (isShuttingDown) return;

      const result = await syncSource(managed);

      // Update global stats
      syncCount++;
      lastSyncAt = new Date().toISOString();
      if (!result.success) {
        errorCount++;
        lastSyncSuccess = false;
      } else {
        lastSyncSuccess = true;
      }

      // Schedule next sync
      scheduleSourceSync(managed);
    }, managed.pollIntervalMs);
  };

  // Run initial sync for all sources
  logger.info('Running initial sync for all sources...');
  const initialResults: SyncResult[] = [];

  for (const managed of managedSources) {
    const result = await syncSource(managed);
    initialResults.push(result);
  }

  const mergedInitial = mergeSyncResults(initialResults);
  syncCount++;
  lastSyncAt = new Date().toISOString();
  lastSyncSuccess = mergedInitial.success;
  if (!mergedInitial.success) {
    errorCount++;
  }

  logger.info({
    created: mergedInitial.created,
    updated: mergedInitial.updated,
    deleted: mergedInitial.deleted,
    errors: mergedInitial.errors.length,
  }, 'Initial sync complete');

  // Start independent polling loops for each source
  for (const managed of managedSources) {
    const intervalMinutes = managed.pollIntervalMs / 60000;
    logger.info({
      source: managed.engine.sourceName,
      intervalMinutes,
    }, 'Starting polling loop');
    scheduleSourceSync(managed);
  }

  // Log health status periodically
  const healthLogInterval = setInterval(() => {
    if (!isShuttingDown) {
      const health = getHealthStatus();
      logger.debug({
        status: health.status,
        uptime: health.uptime,
        syncCount: health.syncCount,
        lastSyncAt: health.lastSyncAt,
      }, 'Health check');
    }
  }, 300000); // Every 5 minutes

  // Cleanup interval on shutdown
  process.on('exit', () => {
    clearInterval(healthLogInterval);
  });

  logger.info('Todoist Bridge running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
