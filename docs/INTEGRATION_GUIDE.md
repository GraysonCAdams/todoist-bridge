# Integration Guide: Adding a New Source

This guide explains how to add a new task source to Todoist Bridge.

## Architecture Overview

Todoist Bridge uses a modular source architecture. Each source is self-contained in its own directory under `src/sources/` and implements a common interface.

```
src/
├── core/
│   └── types.ts          # Core interfaces (SourceEngine, SyncResult)
├── sources/
│   ├── google/           # Google Tasks source
│   │   ├── index.ts      # Public exports
│   │   ├── types.ts      # Configuration types
│   │   ├── auth.ts       # Authentication
│   │   ├── client.ts     # API client
│   │   ├── mapper.ts     # Task mapping
│   │   └── source.ts     # SourceEngine implementation
│   ├── alexa/            # Alexa source
│   │   └── ...
│   └── your-source/      # Your new source
│       └── ...
├── clients/
│   └── todoist.ts        # Todoist API client (shared)
├── storage.ts            # SQLite storage (shared)
└── index.ts              # Main entry point
```

## Step 1: Create Source Directory

Create a new directory for your source:

```bash
mkdir -p src/sources/your-source
```

## Step 2: Define Types

Create `src/sources/your-source/types.ts`:

```typescript
import { z } from 'zod';

// List/mapping configuration
export const YourSourceMappingSchema = z.object({
  source_list_id: z.string(),
  todoist_project_id: z.string(),
  include_completed: z.boolean().default(false),
  delete_after_sync: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

export type YourSourceMapping = z.infer<typeof YourSourceMappingSchema>;

// Source configuration
export const YourSourceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  poll_interval_minutes: z.number().min(1).max(60).default(5),
  // Add source-specific config fields
  api_key: z.string().optional(),
  lists: z.array(YourSourceMappingSchema).default([]),
});

export type YourSourceConfig = z.infer<typeof YourSourceConfigSchema>;
```

## Step 3: Implement API Client

Create `src/sources/your-source/client.ts`:

```typescript
import type { Logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';

// Define your task type
export interface YourTask {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  completed: boolean;
  // Add other fields as needed
}

export class YourSourceClient {
  private logger: Logger;
  private apiKey: string;

  constructor(apiKey: string, logger: Logger) {
    this.apiKey = apiKey;
    this.logger = logger;
  }

  async getTasks(): Promise<YourTask[]> {
    return withRetry(
      async () => {
        // Implement API call to fetch tasks
        const response = await fetch('https://api.yoursource.com/tasks', {
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
        });
        return response.json();
      },
      this.logger,
      'getTasks'
    );
  }

  async deleteTask(taskId: string): Promise<void> {
    return withRetry(
      async () => {
        await fetch(`https://api.yoursource.com/tasks/${taskId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
        });
      },
      this.logger,
      'deleteTask'
    );
  }
}
```

## Step 4: Implement Mapper

Create `src/sources/your-source/mapper.ts`:

```typescript
import type { YourTask } from './client.js';
import type { CreateTaskParams } from '../../clients/todoist.js';

export function mapToTodoistCreate(
  task: YourTask,
  projectId: string
): CreateTaskParams {
  return {
    content: task.title,
    projectId,
    description: task.description,
    dueDate: task.dueDate,
  };
}

export function hasTaskChanged(
  sourceTask: YourTask,
  storedTask: { title: string; description?: string; due_date?: string }
): boolean {
  if (sourceTask.title !== storedTask.title) return true;
  if (sourceTask.description !== storedTask.description) return true;
  if (sourceTask.dueDate !== storedTask.due_date) return true;
  return false;
}
```

## Step 5: Implement SourceEngine

Create `src/sources/your-source/source.ts`:

```typescript
import type { SourceEngine, SyncResult, SourceContext } from '../../core/types.js';
import { createEmptySyncResult, tagsEqual, parseStoredTags } from '../../core/types.js';
import type { YourSourceConfig } from './types.js';
import { YourSourceClient } from './client.js';
import { mapToTodoistCreate, hasTaskChanged } from './mapper.js';

export class YourSource implements SourceEngine {
  // Required: Unique identifier for storage
  readonly sourceId = 'your-source';

  // Required: Human-readable name for logs
  readonly sourceName = 'Your Source';

  private config: YourSourceConfig;
  private client: YourSourceClient;
  private context: SourceContext;

  private constructor(
    config: YourSourceConfig,
    client: YourSourceClient,
    context: SourceContext
  ) {
    this.config = config;
    this.client = client;
    this.context = context;
  }

  // Factory method for initialization
  static async create(
    config: YourSourceConfig,
    context: SourceContext
  ): Promise<YourSource | null> {
    if (!config.enabled) {
      context.logger.info('Your Source disabled');
      return null;
    }

    // Validate configuration
    if (!config.api_key) {
      context.logger.error('API key required for Your Source');
      return null;
    }

    const client = new YourSourceClient(config.api_key, context.logger);

    // Test connection
    try {
      await client.getTasks();
    } catch (error) {
      context.logger.error({ err: error }, 'Failed to connect to Your Source');
      return null;
    }

    context.logger.info('Your Source initialized');
    return new YourSource(config, client, context);
  }

  // Required: Main sync method
  async sync(): Promise<SyncResult> {
    const result = createEmptySyncResult();
    const { logger, storage, todoistClient } = this.context;

    try {
      logger.info('Starting Your Source sync...');

      const tasks = await this.client.getTasks();

      for (const task of tasks) {
        // Implement sync logic:
        // 1. Check if task exists in storage
        // 2. If new: create in Todoist, save to storage
        // 3. If exists: check for changes, update if needed
        // 4. Handle deletions
        // 5. Apply tags

        result.created++;
      }

      logger.info({ ...result }, 'Your Source sync completed');
    } catch (error) {
      result.success = false;
      result.errors.push(`Sync failed: ${error}`);
      logger.error({ err: error }, 'Your Source sync failed');
    }

    return result;
  }

  // Required: Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getTasks();
      return true;
    } catch {
      return false;
    }
  }
}
```

## Step 6: Create Index File

Create `src/sources/your-source/index.ts`:

```typescript
export { YourSource } from './source.js';
export { YourSourceClient } from './client.js';
export type { YourTask } from './client.js';
export type { YourSourceConfig, YourSourceMapping } from './types.js';
```

## Step 7: Add Storage Tables

If your source needs to track synced items, add tables to `src/storage.ts`:

```typescript
// Add to schema initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS your_source_tasks (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    todoist_id TEXT,
    title TEXT NOT NULL,
    source_updated_at TEXT,
    applied_tags TEXT,
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add CRUD methods
createYourSourceTask(data: {...}): void { ... }
getYourSourceTask(id: string): YourSourceTask | null { ... }
updateYourSourceTask(id: string, data: {...}): void { ... }
deleteYourSourceTask(id: string): void { ... }
```

## Step 8: Update Configuration Schema

Add your source to `src/config.ts`:

```typescript
import { YourSourceConfigSchema } from './sources/your-source/types.js';

const SourcesSchema = z.object({
  google: GoogleSourceConfigSchema,
  alexa: AlexaSourceConfigSchema,
  your_source: YourSourceConfigSchema,  // Add this
});
```

## Step 9: Register Source in Main

Update `src/index.ts` to initialize your source:

```typescript
import { YourSource } from './sources/your-source/index.js';

// In main():
if (config.sources.your_source?.enabled) {
  const yourSource = await YourSource.create(
    config.sources.your_source,
    { logger, storage, todoistClient }
  );
  if (yourSource) {
    sources.push(yourSource);
  }
}
```

## Step 10: Add Documentation

1. Create `wiki/YourSource-Setup.md` with setup instructions
2. Update `README.md` to list your source
3. Update `config.example.yaml` with example configuration

## Rate Limits

When implementing a new source, research the API rate limits and set appropriate defaults:

```typescript
// In core/types.ts, add your source limits
export const RATE_LIMITS = {
  MIN_POLL_INTERVAL: {
    google: 1,
    alexa: 2,
    your_source: 1,  // Add based on API limits
  },
  DEFAULT_POLL_INTERVAL: {
    google: 5,
    alexa: 5,
    your_source: 5,
  },
  // ...
};
```

## Testing Your Source

1. Create a test configuration with your source enabled
2. Run with debug logging: `LOG_LEVEL=debug npm run dev`
3. Verify:
   - Authentication works
   - Tasks are fetched correctly
   - Tasks are created in Todoist
   - Tags are applied
   - Changes are detected
   - Deletions are handled
   - Delete-after-sync works (if applicable)

## Best Practices

1. **Use the retry utility** for all API calls
2. **Log at appropriate levels**: debug for details, info for summaries
3. **Handle errors gracefully**: don't crash on individual task failures
4. **Clean up stale cache**: remove entries for deleted Todoist tasks
5. **Respect rate limits**: use appropriate poll intervals
6. **Store timestamps**: for change detection
7. **Support tags**: allow users to categorize synced tasks

## Example Sources

Refer to the existing implementations for guidance:

- `src/sources/google/` - OAuth-based API, task lists
- `src/sources/alexa/` - Cookie-based auth, reminders + shopping list
