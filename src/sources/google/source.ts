/**
 * Google Tasks Source Engine
 *
 * Implements the SourceEngine interface for syncing Google Tasks to Todoist.
 */

import type { SourceEngine, SyncResult, SourceContext } from '../../core/types.js';
import { createEmptySyncResult, tagsEqual, parseStoredTags } from '../../core/types.js';
import type { GoogleSourceConfig, GoogleListMapping } from './types.js';
import type { Storage, Task } from '../../storage.js';
import type { TodoistClient } from '../../clients/todoist.js';
import type { Logger } from '../../utils/logger.js';
import { GoogleAuth } from './auth.js';
import { GoogleTasksClient, type GoogleTask, type GoogleTaskList } from './client.js';
import {
  mapGoogleToTodoistCreate,
  mapGoogleToTodoistUpdate,
  hasGoogleTaskChanged,
} from './mapper.js';

export class GoogleTasksSource implements SourceEngine {
  readonly sourceId = 'google-tasks';
  readonly sourceName = 'Google Tasks';

  private config: GoogleSourceConfig;
  private logger: Logger;
  private storage: Storage;
  private googleClient: GoogleTasksClient;
  private todoistClient: TodoistClient;

  private constructor(
    config: GoogleSourceConfig,
    logger: Logger,
    storage: Storage,
    googleClient: GoogleTasksClient,
    todoistClient: TodoistClient
  ) {
    this.config = config;
    this.logger = logger;
    this.storage = storage;
    this.googleClient = googleClient;
    this.todoistClient = todoistClient;
  }

  /**
   * Factory method to create a Google Tasks source
   */
  static async create(
    config: GoogleSourceConfig,
    context: SourceContext
  ): Promise<GoogleTasksSource | null> {
    if (!config.enabled || config.lists.length === 0) {
      context.logger.info('Google Tasks source disabled or no lists configured');
      return null;
    }

    context.logger.info('Initializing Google Tasks source...');

    const googleAuth = new GoogleAuth(config, context.logger);
    const oauthClient = await googleAuth.getAuthenticatedClient();
    const googleClient = new GoogleTasksClient(oauthClient, context.logger);

    // List all available Google Task lists for discovery
    try {
      const allLists = await googleClient.getTaskLists();
      context.logger.info('='.repeat(60));
      context.logger.info('Available Google Task lists:');
      for (const list of allLists) {
        context.logger.info({
          name: list.title,
          id: list.id,
        }, `  - "${list.title}" (ID: ${list.id})`);
      }
      context.logger.info('='.repeat(60));
    } catch (error) {
      context.logger.warn({ err: error }, 'Could not fetch Google Task lists for discovery');
    }

    context.logger.info({ listCount: config.lists.length }, 'Google Tasks source initialized');

    return new GoogleTasksSource(
      config,
      context.logger,
      context.storage,
      googleClient,
      context.todoistClient
    );
  }

  async sync(): Promise<SyncResult> {
    const result = createEmptySyncResult();

    try {
      this.logger.info('Starting Google Tasks sync...');

      // Clean up stale cache entries before sync
      await this.cleanupStaleCache();

      // Get all Google Task Lists
      const taskLists = await this.googleClient.getTaskLists();
      this.logger.info(`Found ${taskLists.length} Google Task Lists`);

      // Ensure Todoist projects exist for each list
      await this.ensureTodoistProjects(taskLists);

      // Sync tasks for each configured list
      for (const taskList of taskLists) {
        const mapping = this.getMapping(taskList.id);
        if (!mapping) continue;

        try {
          const listResult = await this.syncTaskList(taskList, mapping);
          result.created += listResult.created;
          result.updated += listResult.updated;
          result.deleted += listResult.deleted;
          result.completed += listResult.completed;
          result.deletedFromSource += listResult.deletedFromSource;
          result.tagsUpdated += listResult.tagsUpdated;
        } catch (error) {
          const message = `Failed to sync list "${taskList.title}": ${error}`;
          this.logger.error(message);
          result.errors.push(message);
        }
      }

      // Mark completed tasks as imported if this was the first run with completed tasks
      const hasCompletedMapping = this.config.lists.some(m => m.include_completed);
      if (hasCompletedMapping && !this.storage.hasImportedCompletedTasks()) {
        this.storage.markCompletedTasksImported();
        this.logger.info('Marked completed tasks as imported (one-time retroactive import)');
      }

      // Update sync state
      this.storage.updateSyncState({
        last_sync_at: new Date().toISOString(),
      });

      this.logger.info({
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        completed: result.completed,
        deletedFromSource: result.deletedFromSource,
        tagsUpdated: result.tagsUpdated,
        errors: result.errors.length,
      }, 'Google Tasks sync completed');

    } catch (error) {
      result.success = false;
      const message = `Sync failed: ${error}`;
      result.errors.push(message);
      this.logger.error(message);
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.googleClient.getTaskLists();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up stale cache entries for tasks that no longer exist in Todoist
   */
  private async cleanupStaleCache(): Promise<void> {
    try {
      const rawProjectIds = this.config.lists
        .map((m) => m.todoist_project_id)
        .filter((id): id is string => !!id);

      if (rawProjectIds.length === 0) {
        return;
      }

      const projectIds = await Promise.all(
        rawProjectIds.map((id) => this.todoistClient.resolveProjectId(id))
      );

      const validTodoistIds = await this.todoistClient.getTaskIdsForProjects(projectIds);
      const removed = this.storage.cleanupStaleTasks(validTodoistIds);

      if (removed > 0) {
        this.logger.info(`Cleaned up ${removed} stale task(s) from cache`);
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to clean up stale cache entries');
    }
  }

  private getMapping(googleListId: string): GoogleListMapping | undefined {
    return this.config.lists.find((m) => m.source_list_id === googleListId);
  }

  private shouldIncludeCompleted(mapping: GoogleListMapping): boolean {
    if (!mapping.include_completed) {
      return false;
    }
    // sync_completed_once logic would be handled at config level
    return !this.storage.hasImportedCompletedTasks();
  }

  private async ensureTodoistProjects(taskLists: GoogleTaskList[]): Promise<void> {
    for (const taskList of taskLists) {
      const mapping = this.getMapping(taskList.id);

      if (!mapping) {
        this.logger.debug(`No mapping configured for list: ${taskList.title} (${taskList.id})`);
        continue;
      }

      const resolvedProjectId = await this.todoistClient.resolveProjectId(mapping.todoist_project_id);
      let storedList = this.storage.getTaskListByGoogleId(taskList.id);

      if (!storedList) {
        storedList = this.storage.createTaskList(taskList.id, taskList.title);
        this.logger.debug(`Created task list mapping for: ${taskList.title}`);
      }

      if (storedList.todoist_id !== resolvedProjectId) {
        this.storage.updateTaskListTodoistId(taskList.id, resolvedProjectId);
        this.logger.info(`Applied mapping for "${taskList.title}" -> project ${resolvedProjectId}`);
      }
    }
  }

  private async syncTaskList(
    taskList: GoogleTaskList,
    mapping: GoogleListMapping
  ): Promise<{ created: number; updated: number; deleted: number; completed: number; deletedFromSource: number; tagsUpdated: number }> {
    const stats = { created: 0, updated: 0, deleted: 0, completed: 0, deletedFromSource: 0, tagsUpdated: 0 };
    const configuredTags = mapping.tags || [];

    const storedList = this.storage.getTaskListByGoogleId(taskList.id);
    if (!storedList?.todoist_id) {
      this.logger.warn(`No Todoist project mapped for list: ${taskList.title}`);
      return stats;
    }

    const todoistProjectId = storedList.todoist_id;
    const deleteAfterSync = mapping.delete_after_sync;
    const includeCompleted = this.shouldIncludeCompleted(mapping);

    const googleTasks = await this.googleClient.getTasks(taskList.id, includeCompleted);
    const storedTasks = this.storage.getTasksByGoogleListId(taskList.id);
    const storedTaskMap = new Map(storedTasks.map((t) => [t.google_id, t]));

    this.logger.debug({
      googleTaskCount: googleTasks.length,
      storedTaskCount: storedTasks.length,
      deleteAfterSync,
    }, `Syncing list "${taskList.title}"`);

    const seenGoogleIds = new Set<string>();

    // Process parent tasks first
    const parentTasks = googleTasks.filter((t) => !t.parent);
    const childTasks = googleTasks.filter((t) => t.parent);

    for (const googleTask of parentTasks) {
      seenGoogleIds.add(googleTask.id);
      const taskStats = await this.syncTask(googleTask, storedList.id, taskList.id, todoistProjectId, storedTaskMap, deleteAfterSync, configuredTags);
      stats.created += taskStats.created;
      stats.updated += taskStats.updated;
      stats.completed += taskStats.completed;
      stats.deletedFromSource += taskStats.deletedFromSource;
      stats.tagsUpdated += taskStats.tagsUpdated;
    }

    // Process child tasks
    for (const googleTask of childTasks) {
      seenGoogleIds.add(googleTask.id);
      const parentStoredTask = this.storage.getTaskByGoogleId(googleTask.parent!);
      const parentTodoistId = parentStoredTask?.todoist_id || undefined;

      const taskStats = await this.syncTask(
        googleTask,
        storedList.id,
        taskList.id,
        todoistProjectId,
        storedTaskMap,
        deleteAfterSync,
        configuredTags,
        parentTodoistId
      );
      stats.created += taskStats.created;
      stats.updated += taskStats.updated;
      stats.completed += taskStats.completed;
      stats.deletedFromSource += taskStats.deletedFromSource;
      stats.tagsUpdated += taskStats.tagsUpdated;
    }

    // Detect deleted tasks
    for (const storedTask of storedTasks) {
      if (!seenGoogleIds.has(storedTask.google_id)) {
        if (storedTask.todoist_id) {
          try {
            await this.todoistClient.deleteTask(storedTask.todoist_id);
            this.logger.debug(`Deleted task from Todoist: ${storedTask.title}`);
          } catch (error) {
            this.logger.warn({ err: error }, `Failed to delete task from Todoist: ${storedTask.title}`);
          }
        }
        this.storage.deleteTask(storedTask.google_id);
        stats.deleted++;
      }
    }

    this.logger.debug(stats, `Synced list "${taskList.title}"`);
    return stats;
  }

  private async syncTask(
    googleTask: GoogleTask,
    taskListId: string,
    googleListId: string,
    todoistProjectId: string,
    storedTaskMap: Map<string, Task>,
    deleteAfterSync: boolean,
    configuredTags: string[],
    parentTodoistId?: string
  ): Promise<{ created: number; updated: number; completed: number; deletedFromSource: number; tagsUpdated: number }> {
    const stats = { created: 0, updated: 0, completed: 0, deletedFromSource: 0, tagsUpdated: 0 };
    const storedTask = storedTaskMap.get(googleTask.id);

    if (!storedTask) {
      // New task - create in Todoist
      const createParams = mapGoogleToTodoistCreate(googleTask, todoistProjectId, parentTodoistId);

      if (configuredTags.length > 0) {
        createParams.labels = configuredTags;
      }

      try {
        const todoistTask = await this.todoistClient.createTask(createParams);

        this.storage.createTask({
          google_id: googleTask.id,
          todoist_id: todoistTask.id,
          task_list_id: taskListId,
          title: googleTask.title,
          notes: googleTask.notes || null,
          status: googleTask.status,
          due_date: googleTask.due ? googleTask.due.split('T')[0] : null,
          parent_google_id: googleTask.parent || null,
          parent_todoist_id: parentTodoistId || null,
          google_updated_at: googleTask.updated || null,
          applied_tags: configuredTags.length > 0 ? JSON.stringify(configuredTags) : null,
        });

        if (googleTask.status === 'completed') {
          await this.todoistClient.completeTask(todoistTask.id);
          stats.completed++;
        }

        stats.created++;
        this.logger.debug(`Created task: ${googleTask.title}${configuredTags.length > 0 ? ` with tags: ${configuredTags.join(', ')}` : ''}`);

        if (deleteAfterSync) {
          try {
            await this.googleClient.deleteTask(googleListId, googleTask.id);
            this.storage.deleteTask(googleTask.id);
            stats.deletedFromSource++;
            this.logger.debug(`Deleted task from Google: ${googleTask.title}`);
          } catch (error) {
            this.logger.error({ err: error }, `Failed to delete task from Google: ${googleTask.title}`);
          }
        }
      } catch (error) {
        this.logger.error({ err: error }, `Failed to create task: ${googleTask.title}`);
      }
    } else {
      // Existing task - check for updates
      const taskChanged = hasGoogleTaskChanged(googleTask, storedTask);
      const storedTags = parseStoredTags(storedTask.applied_tags);
      const tagsChanged = !tagsEqual(storedTags, configuredTags);

      if (taskChanged || tagsChanged) {
        const updateParams = taskChanged ? mapGoogleToTodoistUpdate(googleTask, storedTask) : {};

        if (tagsChanged && storedTask.todoist_id) {
          try {
            await this.todoistClient.updateTask(storedTask.todoist_id, { labels: configuredTags });
            stats.tagsUpdated++;
            this.logger.info(`Updated tags for task "${googleTask.title}": ${configuredTags.length > 0 ? configuredTags.join(', ') : '(none)'}`);
          } catch (error) {
            this.logger.error({ err: error }, `Failed to update tags for task: ${googleTask.title}`);
          }
        }

        if (taskChanged && updateParams && storedTask.todoist_id) {
          try {
            await this.todoistClient.updateTask(storedTask.todoist_id, updateParams);
            stats.updated++;
            this.logger.debug(`Updated task: ${googleTask.title}`);
          } catch (error) {
            this.logger.error({ err: error }, `Failed to update task: ${googleTask.title}`);
          }
        }

        if (googleTask.status !== storedTask.status && storedTask.todoist_id) {
          try {
            if (googleTask.status === 'completed') {
              await this.todoistClient.completeTask(storedTask.todoist_id);
              stats.completed++;
              this.logger.debug(`Completed task: ${googleTask.title}`);
            } else {
              await this.todoistClient.reopenTask(storedTask.todoist_id);
              this.logger.debug(`Reopened task: ${googleTask.title}`);
            }
          } catch (error) {
            this.logger.error({ err: error }, `Failed to update task status: ${googleTask.title}`);
          }
        }

        this.storage.updateTask(googleTask.id, {
          title: googleTask.title,
          notes: googleTask.notes || null,
          status: googleTask.status,
          due_date: googleTask.due ? googleTask.due.split('T')[0] : null,
          parent_google_id: googleTask.parent || null,
          parent_todoist_id: parentTodoistId || null,
          google_updated_at: googleTask.updated || null,
          applied_tags: configuredTags.length > 0 ? JSON.stringify(configuredTags) : null,
        });
      }

      if (deleteAfterSync && storedTask.todoist_id) {
        try {
          this.logger.info(`Deleting previously synced task from Google: ${googleTask.title}`);
          await this.googleClient.deleteTask(googleListId, googleTask.id);
          this.storage.deleteTask(googleTask.id);
          stats.deletedFromSource++;
        } catch (error) {
          this.logger.error({ err: error }, `Failed to delete task from Google: ${googleTask.title}`);
        }
      }
    }

    return stats;
  }
}
