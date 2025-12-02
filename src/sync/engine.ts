import type { Config, SyncMapping } from '../config.js';
import type { Logger } from '../utils/logger.js';
import type { Storage, Task } from '../storage.js';
import type { GoogleTasksClient, GoogleTask, GoogleTaskList } from '../clients/google-tasks.js';
import type { TodoistClient } from '../clients/todoist.js';
import {
  mapGoogleToTodoistCreate,
  mapGoogleToTodoistUpdate,
  hasGoogleTaskChanged,
} from './mapper.js';

export interface SyncResult {
  success: boolean;
  listsProcessed: number;
  tasksCreated: number;
  tasksUpdated: number;
  tasksDeleted: number;
  tasksCompleted: number;
  tasksDeletedFromGoogle: number;
  tagsUpdated: number;
  errors: string[];
}

/**
 * Compare two tag arrays for equality (order-independent)
 */
function tagsEqual(tags1: string[], tags2: string[]): boolean {
  if (tags1.length !== tags2.length) return false;
  const sorted1 = [...tags1].sort();
  const sorted2 = [...tags2].sort();
  return sorted1.every((tag, i) => tag === sorted2[i]);
}

/**
 * Parse stored tags JSON string to array
 */
function parseStoredTags(storedTags: string | null): string[] {
  if (!storedTags) return [];
  try {
    return JSON.parse(storedTags);
  } catch {
    return [];
  }
}

export class SyncEngine {
  private config: Config;
  private logger: Logger;
  private storage: Storage;
  private googleClient: GoogleTasksClient;
  private todoistClient: TodoistClient;

  constructor(
    config: Config,
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

  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      listsProcessed: 0,
      tasksCreated: 0,
      tasksUpdated: 0,
      tasksDeleted: 0,
      tasksCompleted: 0,
      tasksDeletedFromGoogle: 0,
      tagsUpdated: 0,
      errors: [],
    };

    try {
      this.logger.info('Starting Google Tasks sync...');

      // Clean up stale cache entries before sync
      await this.cleanupStaleCache();

      // 1. Get all Google Task Lists
      const taskLists = await this.googleClient.getTaskLists();
      this.logger.info(`Found ${taskLists.length} Google Task Lists`);

      // 2. Ensure Todoist projects exist for each list
      await this.ensureTodoistProjects(taskLists);

      // 3. Sync tasks for each configured list
      for (const taskList of taskLists) {
        const mapping = this.getMapping(taskList.id);
        if (!mapping) continue;

        try {
          const listResult = await this.syncTaskList(taskList, mapping);
          result.tasksCreated += listResult.created;
          result.tasksUpdated += listResult.updated;
          result.tasksDeleted += listResult.deleted;
          result.tasksCompleted += listResult.completed;
          result.tasksDeletedFromGoogle += listResult.deletedFromGoogle;
          result.tagsUpdated += listResult.tagsUpdated;
          result.listsProcessed++;
        } catch (error) {
          const message = `Failed to sync list "${taskList.title}": ${error}`;
          this.logger.error(message);
          result.errors.push(message);
        }
      }

      // 4. Mark completed tasks as imported if this was the first run with completed tasks
      const hasCompletedMapping = this.config.sources.google.lists.some(m => m.include_completed);
      if (hasCompletedMapping && !this.storage.hasImportedCompletedTasks()) {
        this.storage.markCompletedTasksImported();
        this.logger.info('Marked completed tasks as imported (one-time retroactive import)');
      }

      // 5. Update sync state
      this.storage.updateSyncState({
        last_sync_at: new Date().toISOString(),
      });

      this.logger.info({
        lists: result.listsProcessed,
        created: result.tasksCreated,
        updated: result.tasksUpdated,
        deleted: result.tasksDeleted,
        completed: result.tasksCompleted,
        deletedFromGoogle: result.tasksDeletedFromGoogle,
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

  /**
   * Clean up stale cache entries for tasks that no longer exist in Todoist
   * This prevents 404 errors when trying to update deleted tasks
   */
  private async cleanupStaleCache(): Promise<void> {
    try {
      // Get all configured Todoist project IDs
      const rawProjectIds = this.config.sources.google.lists
        .map((m) => m.todoist_project_id)
        .filter((id): id is string => !!id);

      if (rawProjectIds.length === 0) {
        return;
      }

      // Resolve special project IDs like "inbox"
      const projectIds = await Promise.all(
        rawProjectIds.map((id) => this.todoistClient.resolveProjectId(id))
      );

      // Get all valid task IDs from Todoist
      const validTodoistIds = await this.todoistClient.getTaskIdsForProjects(projectIds);

      // Remove stale tasks from cache
      const removed = this.storage.cleanupStaleTasks(validTodoistIds);

      if (removed > 0) {
        this.logger.info(`Cleaned up ${removed} stale task(s) from cache`);
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to clean up stale cache entries');
    }
  }

  /**
   * Get the mapping for a Google Task List, if one exists
   */
  private getMapping(googleListId: string): SyncMapping | undefined {
    return this.config.sources.google.lists.find((m) => m.source_list_id === googleListId);
  }

  /**
   * Determine if we should include completed tasks for a specific mapping
   */
  private shouldIncludeCompleted(mapping: SyncMapping): boolean {
    if (!mapping.include_completed) {
      return false;
    }

    // If sync_completed_once is true, only include completed on first run
    if (this.config.sync.sync_completed_once) {
      return !this.storage.hasImportedCompletedTasks();
    }

    return true;
  }

  private async ensureTodoistProjects(taskLists: GoogleTaskList[]): Promise<void> {
    for (const taskList of taskLists) {
      // Check if we have a mapping configured
      const mapping = this.getMapping(taskList.id);

      if (!mapping) {
        // No mapping configured - skip this list
        this.logger.debug(`No mapping configured for list: ${taskList.title} (${taskList.id})`);
        continue;
      }

      // Resolve special project IDs like "inbox"
      const resolvedProjectId = await this.todoistClient.resolveProjectId(mapping.todoist_project_id);

      // Check if we have a stored mapping
      let storedList = this.storage.getTaskListByGoogleId(taskList.id);

      if (!storedList) {
        // Create new stored mapping
        storedList = this.storage.createTaskList(taskList.id, taskList.title);
        this.logger.debug(`Created task list mapping for: ${taskList.title}`);
      }

      // Apply the mapping if not already set (compare with resolved ID)
      if (storedList.todoist_id !== resolvedProjectId) {
        this.storage.updateTaskListTodoistId(taskList.id, resolvedProjectId);
        this.logger.info(`Applied mapping for "${taskList.title}" -> project ${resolvedProjectId}`);
      }
    }
  }

  private async syncTaskList(
    taskList: GoogleTaskList,
    mapping: SyncMapping
  ): Promise<{ created: number; updated: number; deleted: number; completed: number; deletedFromGoogle: number; tagsUpdated: number }> {
    const stats = { created: 0, updated: 0, deleted: 0, completed: 0, deletedFromGoogle: 0, tagsUpdated: 0 };
    const configuredTags = mapping.tags || [];

    // Get the stored mapping
    const storedList = this.storage.getTaskListByGoogleId(taskList.id);
    if (!storedList?.todoist_id) {
      this.logger.warn(`No Todoist project mapped for list: ${taskList.title}`);
      return stats;
    }

    const todoistProjectId = storedList.todoist_id;
    const deleteAfterSync = mapping.delete_after_sync;
    const includeCompleted = this.shouldIncludeCompleted(mapping);

    // Get Google Tasks
    const googleTasks = await this.googleClient.getTasks(taskList.id, includeCompleted);

    // Get stored tasks for this list
    const storedTasks = this.storage.getTasksByGoogleListId(taskList.id);
    const storedTaskMap = new Map(storedTasks.map((t) => [t.google_id, t]));

    this.logger.debug({
      googleTaskCount: googleTasks.length,
      storedTaskCount: storedTasks.length,
      deleteAfterSync,
    }, `Syncing list "${taskList.title}"`);

    // Track which Google task IDs we've seen
    const seenGoogleIds = new Set<string>();

    // First pass: process parent tasks (tasks without parent)
    const parentTasks = googleTasks.filter((t) => !t.parent);
    const childTasks = googleTasks.filter((t) => t.parent);

    // Process parent tasks
    for (const googleTask of parentTasks) {
      seenGoogleIds.add(googleTask.id);
      const result = await this.syncTask(googleTask, storedList.id, taskList.id, todoistProjectId, storedTaskMap, deleteAfterSync, configuredTags);
      stats.created += result.created;
      stats.updated += result.updated;
      stats.completed += result.completed;
      stats.deletedFromGoogle += result.deletedFromGoogle;
      stats.tagsUpdated += result.tagsUpdated;
    }

    // Second pass: process child tasks (subtasks)
    for (const googleTask of childTasks) {
      seenGoogleIds.add(googleTask.id);

      // Find parent's Todoist ID
      const parentStoredTask = this.storage.getTaskByGoogleId(googleTask.parent!);
      const parentTodoistId = parentStoredTask?.todoist_id || undefined;

      const result = await this.syncTask(
        googleTask,
        storedList.id,
        taskList.id,
        todoistProjectId,
        storedTaskMap,
        deleteAfterSync,
        configuredTags,
        parentTodoistId
      );
      stats.created += result.created;
      stats.updated += result.updated;
      stats.completed += result.completed;
      stats.deletedFromGoogle += result.deletedFromGoogle;
      stats.tagsUpdated += result.tagsUpdated;
    }

    // Third pass: detect deleted tasks
    for (const storedTask of storedTasks) {
      if (!seenGoogleIds.has(storedTask.google_id)) {
        // Task was deleted from Google
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
  ): Promise<{ created: number; updated: number; completed: number; deletedFromGoogle: number; tagsUpdated: number }> {
    const stats = { created: 0, updated: 0, completed: 0, deletedFromGoogle: 0, tagsUpdated: 0 };
    const storedTask = storedTaskMap.get(googleTask.id);

    if (!storedTask) {
      // New task - create in Todoist
      const createParams = mapGoogleToTodoistCreate(googleTask, todoistProjectId, parentTodoistId);

      // Add configured tags
      if (configuredTags.length > 0) {
        createParams.labels = configuredTags;
      }

      try {
        const todoistTask = await this.todoistClient.createTask(createParams);

        // Store the mapping with applied tags
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

        // If task is completed in Google, complete it in Todoist
        if (googleTask.status === 'completed') {
          await this.todoistClient.completeTask(todoistTask.id);
          stats.completed++;
        }

        stats.created++;
        this.logger.debug(`Created task: ${googleTask.title}${configuredTags.length > 0 ? ` with tags: ${configuredTags.join(', ')}` : ''}`);

        // Delete from Google Tasks if configured for this list
        if (deleteAfterSync) {
          try {
            await this.googleClient.deleteTask(googleListId, googleTask.id);
            this.storage.deleteTask(googleTask.id);
            stats.deletedFromGoogle++;
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

        // Handle tag changes - update labels on Todoist task
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

        // Handle status changes
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

        // Update stored task
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

      // Delete previously synced task from Google if delete_after_sync is enabled
      // This handles tasks that were synced before the option was turned on
      if (deleteAfterSync && storedTask.todoist_id) {
        try {
          this.logger.info(`Deleting previously synced task from Google: ${googleTask.title}`);
          await this.googleClient.deleteTask(googleListId, googleTask.id);
          this.storage.deleteTask(googleTask.id);
          stats.deletedFromGoogle++;
        } catch (error) {
          this.logger.error({ err: error }, `Failed to delete task from Google: ${googleTask.title}`);
        }
      }
    }

    return stats;
  }
}
