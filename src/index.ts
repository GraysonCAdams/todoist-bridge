import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { Storage } from './storage.js';
import { GoogleAuth } from './auth/google.js';
import { TodoistAuth } from './auth/todoist.js';
import { GoogleTasksClient } from './clients/google-tasks.js';
import { TodoistClient } from './clients/todoist.js';
import { SyncEngine } from './sync/engine.js';
import { AlexaAuth } from './auth/alexa.js';
import { AlexaClient } from './clients/alexa.js';
import { AlexaSyncEngine } from './sync/alexa-engine.js';
import { AlexaShoppingSyncEngine } from './sync/alexa-shopping-engine.js';
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

async function main() {
  // Load configuration
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info({ version: VERSION }, 'Task Sync starting...');
  logger.info({ pollInterval: config.poll_interval_minutes }, 'Poll interval configured');

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

  // Initialize sync engines
  let googleSyncEngine: SyncEngine | null = null;
  let alexaSyncEngine: AlexaSyncEngine | null = null;
  let alexaShoppingSyncEngine: AlexaShoppingSyncEngine | null = null;

  // Initialize Google Tasks sync (if enabled and has mappings)
  if (config.sources.google.enabled && config.sources.google.lists.length > 0) {
    logger.info('Initializing Google Tasks integration...');
    const googleAuth = new GoogleAuth(config, logger);
    const googleOAuthClient = await googleAuth.getAuthenticatedClient();
    const googleClient = new GoogleTasksClient(googleOAuthClient, config, logger);
    googleSyncEngine = new SyncEngine(config, logger, storage, googleClient, todoistClient);
    logger.info({ listCount: config.sources.google.lists.length }, 'Google Tasks integration enabled');
  } else {
    logger.info('Google Tasks integration disabled (no lists configured)');
  }

  // Initialize Alexa sync (if enabled and has reminders or shopping list configured)
  const hasAlexaReminders = config.sources.alexa.lists.length > 0;
  const hasAlexaShopping = config.sources.alexa.sync_shopping_list.enabled &&
                           config.sources.alexa.sync_shopping_list.todoist_project_id;

  if (config.sources.alexa.enabled && (hasAlexaReminders || hasAlexaShopping)) {
    logger.info('Initializing Alexa integration...');

    try {
      const alexaAuth = new AlexaAuth(config, logger);
      const alexaRemote = await alexaAuth.getAuthenticatedClient();
      const alexaClient = new AlexaClient(alexaRemote, logger);

      // Initialize reminders sync if configured
      if (hasAlexaReminders) {
        alexaSyncEngine = new AlexaSyncEngine(config, logger, storage, alexaClient, todoistClient);
        logger.info('Alexa reminders sync enabled');
      }

      // Initialize shopping list sync if configured
      if (hasAlexaShopping) {
        alexaShoppingSyncEngine = new AlexaShoppingSyncEngine(config, logger, storage, alexaClient, todoistClient);
        logger.info('Alexa shopping list sync enabled');
      }

      logger.info('Alexa integration enabled - running initial sync...');

      // Sync immediately after successful Alexa authentication
      if (alexaSyncEngine) {
        await alexaSyncEngine.sync();
      }
      if (alexaShoppingSyncEngine) {
        await alexaShoppingSyncEngine.sync();
      }
    } catch (error) {
      if (config.sources.alexa.fail_silently) {
        logger.error({ err: error }, 'Failed to initialize Alexa integration (continuing without it)');
      } else {
        throw error;
      }
    }
  } else {
    logger.info('Alexa integration disabled (not enabled or no lists/shopping configured)');
  }

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

  // Run initial Google sync
  if (googleSyncEngine) {
    logger.info('Running initial Google Tasks sync...');
    await googleSyncEngine.sync();
  }

  // Unified sync function - runs all enabled sources together
  const syncAll = async () => {
    if (isShuttingDown) return;

    const startTime = Date.now();
    logger.info('Starting sync cycle...');

    let hasError = false;

    // Run all syncs together (in parallel for efficiency)
    const syncPromises: Promise<unknown>[] = [];

    if (googleSyncEngine) {
      syncPromises.push(
        googleSyncEngine.sync().catch((error) => {
          logger.error({ err: error }, 'Google Tasks sync error');
          hasError = true;
        })
      );
    }

    if (alexaSyncEngine) {
      syncPromises.push(
        alexaSyncEngine.sync().catch((error) => {
          logger.error({ err: error }, 'Alexa reminders sync error');
          hasError = true;
        })
      );
    }

    if (alexaShoppingSyncEngine) {
      syncPromises.push(
        alexaShoppingSyncEngine.sync().catch((error) => {
          logger.error({ err: error }, 'Alexa shopping list sync error');
          hasError = true;
        })
      );
    }

    await Promise.all(syncPromises);

    const duration = Date.now() - startTime;
    syncCount++;
    lastSyncAt = new Date().toISOString();
    lastSyncSuccess = !hasError;

    if (hasError) {
      errorCount++;
      logger.warn({ duration, syncCount }, 'Sync cycle completed with errors');
    } else {
      logger.info({ duration, syncCount }, 'Sync cycle complete');
    }
  };

  // Start polling loop
  const pollIntervalMs = config.poll_interval_minutes * 60 * 1000;
  logger.info({ intervalMinutes: config.poll_interval_minutes }, 'Starting polling loop');

  let pollTimeout: NodeJS.Timeout | null = null;

  const poll = async () => {
    if (isShuttingDown) return;

    await syncAll();

    // Schedule next poll
    if (!isShuttingDown) {
      pollTimeout = setTimeout(poll, pollIntervalMs);
    }
  };

  // Schedule first poll
  pollTimeout = setTimeout(poll, pollIntervalMs);

  // Keep process alive and log health status periodically
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
    if (pollTimeout) {
      clearTimeout(pollTimeout);
    }
  });

  logger.info('Sync daemon running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
