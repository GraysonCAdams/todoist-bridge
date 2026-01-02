/**
 * Microsoft To-Do Source Engine
 * Implements bi-directional sync between Microsoft To-Do and Todoist
 */

import type { SourceContext } from '../../core/types.js';
import type {
  BidirectionalSourceEngine,
  BidirectionalSyncResult,
} from '../../core/bidirectional-types.js';
import { createEmptyBidirectionalSyncResult } from '../../core/bidirectional-types.js';
import type { MicrosoftSourceConfig, MicrosoftTodoTask, MicrosoftListMapping } from './types.js';
import type { Storage, MicrosoftTodoItemRecord } from '../../storage.js';
import type { TodoistClient } from '../../clients/todoist.js';
import type { Logger } from '../../utils/logger.js';
import { MicrosoftAuth } from './auth.js';
import { MicrosoftTodoClient } from './client.js';
import {
  mapMicrosoftToTodoistCreate,
  mapMicrosoftToTodoistUpdate,
  mapTodoistToMicrosoftCreate,
  hasMicrosoftTaskChanged,
  hasCompletionStatusChanged,
  resolveConflict,
  createStoredRecordFromMicrosoft,
  createStoredRecordFromTodoist,
  generateContentHash,
  type TodoistTask,
} from './mapper.js';

export class MicrosoftTodoSource implements BidirectionalSourceEngine {
  readonly sourceId = 'microsoft-todo';
  readonly sourceName = 'Microsoft To-Do';

  private config: MicrosoftSourceConfig;
  private logger: Logger;
  private storage: Storage;
  private msClient: MicrosoftTodoClient;
  private todoistClient: TodoistClient;
  private readonly currentUserId: string | null = null;

  private constructor(
    config: MicrosoftSourceConfig,
    logger: Logger,
    storage: Storage,
    msClient: MicrosoftTodoClient,
    todoistClient: TodoistClient,
    currentUserId: string | null
  ) {
    this.config = config;
    this.logger = logger;
    this.storage = storage;
    this.msClient = msClient;
    this.todoistClient = todoistClient;
    this.currentUserId = currentUserId;
  }

  static async create(
    config: MicrosoftSourceConfig,
    context: SourceContext
  ): Promise<MicrosoftTodoSource | null> {
    if (!config.enabled || config.lists.length === 0) {
      context.logger.info('Microsoft To-Do source disabled or no lists configured');
      return null;
    }

    if (!config.client_id) {
      context.logger.error('Microsoft To-Do requires client_id configuration');
      return null;
    }

    context.logger.info('Initializing Microsoft To-Do source...');

    const auth = new MicrosoftAuth(config, context.logger);

    // Verify authentication works
    try {
      await auth.getAccessToken();
    } catch (error) {
      context.logger.error({ err: error }, 'Microsoft authentication failed');
      return null;
    }

    const msClient = new MicrosoftTodoClient(
      () => auth.getAccessToken(),
      context.logger
    );

    // List all available Microsoft To-Do lists for discovery
    try {
      const allLists = await msClient.getLists();
      context.logger.info('='.repeat(60));
      context.logger.info('Available Microsoft To-Do lists:');
      for (const list of allLists) {
        context.logger.info({
          name: list.displayName,
          id: list.id,
          isShared: list.isShared,
          isOwner: list.isOwner,
        }, `  - "${list.displayName}"`);
      }
      context.logger.info('='.repeat(60));
    } catch (error) {
      context.logger.warn({ err: error }, 'Could not fetch Microsoft To-Do lists for discovery');
    }

    // Get current user ID for filtering assignments
    let currentUserId: string | null = null;
    if (config.exclude_others_assignments) {
      try {
        const user = await msClient.getCurrentUser();
        currentUserId = user.id;
        context.logger.info({ userId: currentUserId, userName: user.displayName }, 'Got current user for assignment filtering');
      } catch (error) {
        context.logger.warn({ err: error }, 'Could not get current user ID, assignment filtering disabled');
      }
    }

    context.logger.info({ listCount: config.lists.length }, 'Microsoft To-Do source initialized');

    return new MicrosoftTodoSource(
      config,
      context.logger,
      context.storage,
      msClient,
      context.todoistClient,
      currentUserId
    );
  }

  async sync(): Promise<BidirectionalSyncResult> {
    return this.syncBidirectional();
  }

  async syncBidirectional(): Promise<BidirectionalSyncResult> {
    const result = createEmptyBidirectionalSyncResult();

    for (const mapping of this.config.lists) {
      try {
        const listResult = await this.syncList(mapping);

        // Merge results
        result.created += listResult.created;
        result.updated += listResult.updated;
        result.deleted += listResult.deleted;
        result.completed += listResult.completed;
        result.deletedFromSource += listResult.deletedFromSource;
        result.tagsUpdated += listResult.tagsUpdated;
        result.createdInSource += listResult.createdInSource;
        result.updatedInSource += listResult.updatedInSource;
        result.completedInSource += listResult.completedInSource;
        result.errors.push(...listResult.errors);
      } catch (error) {
        const errorMsg = `Failed to sync list ${mapping.list_name || mapping.source_list_id}: ${error}`;
        this.logger.error({ err: error }, errorMsg);
        result.errors.push(errorMsg);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  private async syncList(mapping: MicrosoftListMapping): Promise<BidirectionalSyncResult> {
    const result = createEmptyBidirectionalSyncResult();

    // Resolve list ID
    let listId = mapping.source_list_id;
    if (!listId && mapping.list_name) {
      const list = await this.msClient.getListByName(mapping.list_name);
      if (!list) {
        result.errors.push(`Microsoft To-Do list "${mapping.list_name}" not found`);
        return result;
      }
      listId = list.id;
      this.logger.info({ listName: mapping.list_name, listId }, 'Resolved list ID from name');
    }

    if (!listId) {
      result.errors.push('No list_id or list_name configured');
      return result;
    }

    // Resolve Todoist project ID
    const todoistProjectId = await this.todoistClient.resolveProjectId(mapping.todoist_project_id);
    if (!todoistProjectId) {
      result.errors.push(`Todoist project "${mapping.todoist_project_id}" not found`);
      return result;
    }

    // Fetch data from both platforms
    const [allMsItems, todoistTasks, storedItems] = await Promise.all([
      this.msClient.getTasks(listId, mapping.include_completed),
      this.todoistClient.getProjectTasks(todoistProjectId),
      this.storage.getMicrosoftItemsByListId(listId),
    ]);

    // Filter out items assigned to others (if enabled)
    const msItems = this.filterByAssignment(allMsItems);

    this.logger.debug({
      listId,
      msItemCount: msItems.length,
      msItemsFiltered: allMsItems.length - msItems.length,
      todoistTaskCount: todoistTasks.length,
      storedItemCount: storedItems.length,
    }, 'Fetched items for sync');

    // Build lookup maps
    const msItemMap = new Map(msItems.map((item) => [item.id, item]));
    const todoistTaskMap = new Map(todoistTasks.map((task) => [task.id, task as TodoistTask]));
    const storedByMsId = new Map(storedItems.map((item) => [item.microsoft_id, item]));
    const storedByTodoistId = new Map(
      storedItems.filter((item) => item.todoist_id).map((item) => [item.todoist_id!, item])
    );

    const tags = mapping.tags || [];
    const seenMicrosoftIds = new Set<string>();
    const seenTodoistIds = new Set<string>();

    // Phase 1: Process Microsoft items
    for (const msItem of msItems) {
      seenMicrosoftIds.add(msItem.id);
      const stored = storedByMsId.get(msItem.id);

      if (!stored) {
        // New item from Microsoft → Create in Todoist
        await this.createInTodoist(msItem, listId, todoistProjectId, tags, result);
      } else if (stored.todoist_id) {
        seenTodoistIds.add(stored.todoist_id);
        const todoistTask = todoistTaskMap.get(stored.todoist_id);

        if (todoistTask) {
          // Both exist → Check for changes and resolve conflicts
          await this.syncExistingItem(msItem, todoistTask, stored, listId, tags, result);
        } else {
          // Todoist task was deleted → Delete from Microsoft or recreate in Todoist
          await this.handleTodoistDeletion(msItem, stored, listId, todoistProjectId, tags, result);
        }
      }
    }

    // Phase 2: Process Todoist tasks not yet seen (new from Todoist)
    for (const todoistTask of todoistTasks) {
      if (seenTodoistIds.has(todoistTask.id)) continue;

      const stored = storedByTodoistId.get(todoistTask.id);
      if (!stored) {
        // New item from Todoist → Create in Microsoft
        await this.createInMicrosoft(todoistTask as TodoistTask, listId, tags, result);
      }
    }

    // Phase 3: Handle deletions (items in storage but not in either platform)
    for (const stored of storedItems) {
      const msExists = msItemMap.has(stored.microsoft_id);
      const todoistExists = stored.todoist_id ? todoistTaskMap.has(stored.todoist_id) : false;

      if (!msExists && !todoistExists) {
        // Both deleted → Remove from storage
        this.storage.deleteMicrosoftItem(stored.microsoft_id);
        this.logger.debug({ microsoftId: stored.microsoft_id }, 'Cleaned up orphaned storage record');
      } else if (!msExists && todoistExists && stored.todoist_id) {
        // Microsoft deleted, Todoist exists → Delete from Todoist
        try {
          await this.todoistClient.deleteTask(stored.todoist_id);
          this.storage.deleteMicrosoftItem(stored.microsoft_id);
          result.deleted++;
          this.logger.info({ todoistId: stored.todoist_id }, 'Deleted Todoist task (Microsoft item was deleted)');
        } catch (error) {
          this.logger.warn({ err: error, todoistId: stored.todoist_id }, 'Failed to delete Todoist task');
        }
      }
    }

    return result;
  }

  private async createInTodoist(
    msItem: MicrosoftTodoTask,
    listId: string,
    projectId: string,
    tags: string[],
    result: BidirectionalSyncResult
  ): Promise<void> {
    try {
      const createParams = mapMicrosoftToTodoistCreate(msItem, projectId, tags);
      const todoistTask = await this.todoistClient.createTask(createParams);

      // If Microsoft item is completed, complete in Todoist too
      if (msItem.status === 'completed') {
        await this.todoistClient.completeTask(todoistTask.id);
        result.completed++;
      }

      // Store the mapping
      const storedRecord = createStoredRecordFromMicrosoft(msItem, listId, todoistTask.id, tags);
      this.storage.createMicrosoftItem(storedRecord);

      result.created++;
      this.logger.info({ title: msItem.title, todoistId: todoistTask.id }, 'Created Todoist task from Microsoft');
    } catch (error) {
      const errorMsg = `Failed to create Todoist task for "${msItem.title}": ${error}`;
      this.logger.error({ err: error }, errorMsg);
      result.errors.push(errorMsg);
    }
  }

  private async createInMicrosoft(
    todoistTask: TodoistTask,
    listId: string,
    tags: string[],
    result: BidirectionalSyncResult
  ): Promise<void> {
    try {
      const createParams = mapTodoistToMicrosoftCreate(todoistTask, this.config);
      const msItem = await this.msClient.createTask(listId, createParams);

      // If Todoist task is completed, complete in Microsoft too
      if (todoistTask.isCompleted) {
        await this.msClient.completeTask(listId, msItem.id);
        result.completedInSource++;
      }

      // Store the mapping
      const storedRecord = createStoredRecordFromTodoist(todoistTask, msItem.id, listId, tags);
      this.storage.createMicrosoftItem(storedRecord);

      result.createdInSource++;
      this.logger.info({ title: todoistTask.content, microsoftId: msItem.id }, 'Created Microsoft task from Todoist');
    } catch (error) {
      const errorMsg = `Failed to create Microsoft task for "${todoistTask.content}": ${error}`;
      this.logger.error({ err: error }, errorMsg);
      result.errors.push(errorMsg);
    }
  }

  private async syncExistingItem(
    msItem: MicrosoftTodoTask,
    todoistTask: TodoistTask,
    stored: MicrosoftTodoItemRecord,
    listId: string,
    tags: string[],
    result: BidirectionalSyncResult
  ): Promise<void> {
    // Check completion status first
    const completionStatus = hasCompletionStatusChanged(msItem, todoistTask);
    if (completionStatus.differs) {
      await this.syncCompletionStatus(msItem, todoistTask, stored, listId, completionStatus, result);
      return; // Don't sync other changes when completion status differs
    }

    // Resolve content conflicts (last write wins)
    const winner = resolveConflict(msItem, todoistTask, stored);

    if (winner === 'microsoft') {
      // Microsoft wins → Update Todoist
      await this.updateTodoistFromMicrosoft(msItem, todoistTask, stored, tags, result);
    } else if (winner === 'todoist') {
      // Todoist wins → Update Microsoft
      await this.updateMicrosoftFromTodoist(msItem, todoistTask, stored, listId, result);
    }
    // winner === 'none' means no changes needed
  }

  private async syncCompletionStatus(
    msItem: MicrosoftTodoTask,
    todoistTask: TodoistTask,
    stored: MicrosoftTodoItemRecord,
    listId: string,
    status: { microsoftCompleted: boolean; todoistCompleted: boolean },
    result: BidirectionalSyncResult
  ): Promise<void> {
    // Use timestamps to determine which completion is newer
    const msModified = msItem.lastModifiedDateTime
      ? new Date(msItem.lastModifiedDateTime).getTime()
      : 0;
    const todoistModified = stored.todoist_modified_at
      ? new Date(stored.todoist_modified_at).getTime()
      : 0;

    if (msModified >= todoistModified) {
      // Microsoft is newer → Update Todoist
      if (status.microsoftCompleted) {
        await this.todoistClient.completeTask(todoistTask.id);
        result.completed++;
        this.logger.info({ title: msItem.title }, 'Completed Todoist task (from Microsoft)');
      } else {
        await this.todoistClient.reopenTask(todoistTask.id);
        result.updated++;
        this.logger.info({ title: msItem.title }, 'Reopened Todoist task (from Microsoft)');
      }
    } else {
      // Todoist is newer → Update Microsoft
      if (status.todoistCompleted) {
        await this.msClient.completeTask(listId, msItem.id);
        result.completedInSource++;
        this.logger.info({ title: msItem.title }, 'Completed Microsoft task (from Todoist)');
      } else {
        await this.msClient.reopenTask(listId, msItem.id);
        result.updatedInSource++;
        this.logger.info({ title: msItem.title }, 'Reopened Microsoft task (from Todoist)');
      }
    }

    // Update stored record
    this.storage.updateMicrosoftItem(stored.microsoft_id, {
      status: status.microsoftCompleted ? 'completed' : 'notStarted',
      microsoft_modified_at: msItem.lastModifiedDateTime,
      todoist_modified_at: new Date().toISOString(),
    });
  }

  private async updateTodoistFromMicrosoft(
    msItem: MicrosoftTodoTask,
    todoistTask: TodoistTask,
    stored: MicrosoftTodoItemRecord,
    tags: string[],
    result: BidirectionalSyncResult
  ): Promise<void> {
    try {
      const updates = mapMicrosoftToTodoistUpdate(msItem, stored, tags);

      // Only update if there are actual changes
      if (Object.keys(updates).length > 0) {
        await this.todoistClient.updateTask(todoistTask.id, updates);
        result.updated++;
        this.logger.info({ title: msItem.title }, 'Updated Todoist task from Microsoft');
      }

      // Update stored record
      this.storage.updateMicrosoftItem(stored.microsoft_id, {
        title: msItem.title,
        body: msItem.body?.content || null,
        due_date: msItem.dueDateTime?.dateTime?.split('T')[0] || null,
        microsoft_modified_at: msItem.lastModifiedDateTime,
        todoist_modified_at: new Date().toISOString(),
        content_hash: generateContentHash(
          msItem.title,
          msItem.body?.content,
          msItem.status,
          msItem.dueDateTime?.dateTime?.split('T')[0]
        ),
      });
    } catch (error) {
      const errorMsg = `Failed to update Todoist task "${msItem.title}": ${error}`;
      this.logger.error({ err: error }, errorMsg);
      result.errors.push(errorMsg);
    }
  }

  private async updateMicrosoftFromTodoist(
    msItem: MicrosoftTodoTask,
    todoistTask: TodoistTask,
    stored: MicrosoftTodoItemRecord,
    listId: string,
    result: BidirectionalSyncResult
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = {};

      if (todoistTask.content !== stored.title) {
        updates.title = todoistTask.content;
      }
      if (todoistTask.description !== (stored.body || '')) {
        updates.body = todoistTask.description
          ? { content: todoistTask.description, contentType: 'text' }
          : null;
      }
      if (todoistTask.due?.date !== stored.due_date) {
        if (todoistTask.due?.date) {
          updates.dueDateTime = {
            dateTime: new Date(todoistTask.due.date).toISOString(),
            timeZone: 'UTC',
          };
        } else {
          updates.dueDateTime = null;
        }
      }

      if (Object.keys(updates).length > 0) {
        await this.msClient.updateTask(listId, msItem.id, updates);
        result.updatedInSource++;
        this.logger.info({ title: todoistTask.content }, 'Updated Microsoft task from Todoist');
      }

      // Update stored record
      const status = todoistTask.isCompleted ? 'completed' : 'notStarted';
      this.storage.updateMicrosoftItem(stored.microsoft_id, {
        title: todoistTask.content,
        body: todoistTask.description || null,
        due_date: todoistTask.due?.date || null,
        microsoft_modified_at: new Date().toISOString(),
        todoist_modified_at: new Date().toISOString(),
        content_hash: generateContentHash(
          todoistTask.content,
          todoistTask.description,
          status,
          todoistTask.due?.date
        ),
      });
    } catch (error) {
      const errorMsg = `Failed to update Microsoft task "${todoistTask.content}": ${error}`;
      this.logger.error({ err: error }, errorMsg);
      result.errors.push(errorMsg);
    }
  }

  private async handleTodoistDeletion(
    msItem: MicrosoftTodoTask,
    stored: MicrosoftTodoItemRecord,
    listId: string,
    projectId: string,
    tags: string[],
    result: BidirectionalSyncResult
  ): Promise<void> {
    // Todoist task was deleted - recreate it from Microsoft
    // This ensures Microsoft is the authoritative source for items that exist there
    this.logger.info({ title: msItem.title }, 'Todoist task deleted, recreating from Microsoft');

    try {
      const createParams = mapMicrosoftToTodoistCreate(msItem, projectId, tags);
      const todoistTask = await this.todoistClient.createTask(createParams);

      if (msItem.status === 'completed') {
        await this.todoistClient.completeTask(todoistTask.id);
      }

      // Update stored record with new Todoist ID
      this.storage.updateMicrosoftItem(stored.microsoft_id, {
        todoist_id: todoistTask.id,
        todoist_modified_at: new Date().toISOString(),
      });

      result.created++;
    } catch (error) {
      const errorMsg = `Failed to recreate Todoist task "${msItem.title}": ${error}`;
      this.logger.error({ err: error }, errorMsg);
      result.errors.push(errorMsg);
    }
  }

  /**
   * Filter Microsoft items to exclude those assigned to others
   * Only includes items that are:
   * - Unassigned (no createdBy)
   * - Created by the current user
   */
  private filterByAssignment(items: MicrosoftTodoTask[]): MicrosoftTodoTask[] {
    // If filtering is disabled or we don't have a user ID, return all items
    if (!this.config.exclude_others_assignments || !this.currentUserId) {
      return items;
    }

    return items.filter((item) => {
      // If no createdBy info, include the item (unassigned or created by self)
      if (!item.createdBy?.user?.id) {
        return true;
      }

      // Include if created by the current user
      const isCreatedBySelf = item.createdBy.user.id === this.currentUserId;

      if (!isCreatedBySelf) {
        this.logger.debug(
          { title: item.title, createdBy: item.createdBy.user.displayName },
          'Excluding item assigned to another user'
        );
      }

      return isCreatedBySelf;
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      return await this.msClient.healthCheck();
    } catch {
      return false;
    }
  }
}
