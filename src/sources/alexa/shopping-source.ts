/**
 * Alexa Shopping List Source Engine
 *
 * Implements the SourceEngine interface for syncing Alexa shopping list to Todoist.
 */

import type { SourceEngine, SyncResult, SourceContext } from '../../core/types.js';
import { createEmptySyncResult, tagsEqual, parseStoredTags } from '../../core/types.js';
import type { AlexaSourceConfig } from './types.js';
import type { Storage, AlexaShoppingItemRecord } from '../../storage.js';
import type { TodoistClient } from '../../clients/todoist.js';
import type { Logger } from '../../utils/logger.js';
import { AlexaAuth } from './auth.js';
import { AlexaClient, type AlexaShoppingItem } from './client.js';
import { mapAlexaShoppingToTodoistCreate, hasAlexaShoppingItemChanged } from './mapper.js';

export class AlexaShoppingSource implements SourceEngine {
  readonly sourceId = 'alexa-shopping';
  readonly sourceName = 'Alexa Shopping List';

  private config: AlexaSourceConfig;
  private logger: Logger;
  private storage: Storage;
  private alexaClient: AlexaClient;
  private todoistClient: TodoistClient;
  private shoppingListId: string | null = null;

  private constructor(
    config: AlexaSourceConfig,
    logger: Logger,
    storage: Storage,
    alexaClient: AlexaClient,
    todoistClient: TodoistClient
  ) {
    this.config = config;
    this.logger = logger;
    this.storage = storage;
    this.alexaClient = alexaClient;
    this.todoistClient = todoistClient;
  }

  /**
   * Factory method to create an Alexa Shopping source
   */
  static async create(
    config: AlexaSourceConfig,
    context: SourceContext,
    alexaClient?: AlexaClient
  ): Promise<AlexaShoppingSource | null> {
    const shoppingConfig = config.sync_shopping_list;

    if (!config.enabled || !shoppingConfig.enabled || !shoppingConfig.todoist_project_id) {
      context.logger.info('Alexa Shopping source disabled or not configured');
      return null;
    }

    context.logger.info('Initializing Alexa Shopping source...');

    let client = alexaClient;
    if (!client) {
      try {
        const alexaAuth = new AlexaAuth(config, context.logger);
        const alexaRemote = await alexaAuth.getAuthenticatedClient();
        client = new AlexaClient(alexaRemote, context.logger);
      } catch (error) {
        if (config.fail_silently) {
          context.logger.error({ err: error }, 'Failed to initialize Alexa Shopping (continuing without it)');
          return null;
        }
        throw error;
      }
    }

    context.logger.info('Alexa Shopping source initialized');

    return new AlexaShoppingSource(
      config,
      context.logger,
      context.storage,
      client,
      context.todoistClient
    );
  }

  async sync(): Promise<SyncResult> {
    const result = createEmptySyncResult();

    try {
      const shoppingConfig = this.config.sync_shopping_list;

      if (!shoppingConfig.enabled) {
        return result;
      }

      const configuredProjectId = shoppingConfig.todoist_project_id;
      if (!configuredProjectId) {
        throw new Error('No todoist_project_id configured for Alexa shopping list');
      }

      const todoistProjectId = await this.todoistClient.resolveProjectId(configuredProjectId);

      this.logger.info('Starting Alexa shopping list sync...');

      // Get shopping list ID (needed for complete/delete operations)
      this.shoppingListId = await this.alexaClient.getShoppingListId();
      if (!this.shoppingListId) {
        this.logger.warn('Alexa shopping list not found');
        return result;
      }

      const configuredTags = shoppingConfig.tags || [];
      const deleteAfterSync = shoppingConfig.delete_after_sync;

      // Always fetch ALL items (completed + active) to distinguish checked vs truly deleted
      const alexaItems = await this.alexaClient.getShoppingItems(true);
      const alexaItemMap = new Map(alexaItems.map((item) => [item.id, item]));

      // Get stored items
      const storedItems = this.storage.getAllAlexaShoppingItems();
      const storedMap = new Map(storedItems.map((item) => [item.alexa_id, item]));

      // Todoist→Alexa: complete Alexa items whose paired Todoist task was completed/deleted
      const activeTodoistIds = await this.todoistClient.getTaskIdsForProjects([todoistProjectId]);
      const handledIds = new Set<string>();

      for (const stored of storedItems) {
        if (stored.todoist_id && !activeTodoistIds.has(stored.todoist_id) && stored.completed === 0) {
          // Todoist task completed/deleted — complete the Alexa item if it's still active
          const alexaItem = alexaItemMap.get(stored.alexa_id);
          if (alexaItem && !alexaItem.completed) {
            try {
              await this.alexaClient.completeListItem(this.shoppingListId!, stored.alexa_id, alexaItem.value, alexaItem.version);
              this.storage.updateAlexaShoppingItem(stored.alexa_id, {
                completed: 1,
                alexa_updated_at: new Date().toISOString(),
              });
              handledIds.add(stored.alexa_id);
              this.logger.debug(`Completed Alexa shopping item (Todoist task done): ${alexaItem.value}`);
            } catch (e) {
              this.logger.warn({ err: e }, `Failed to complete Alexa item: ${stored.value}`);
            }
          }
        }
      }

      this.logger.debug({
        alexaItemCount: alexaItems.length,
        storedItemCount: storedItems.length,
        todoistCompletedCount: handledIds.size,
        deleteAfterSync,
      }, 'Syncing Alexa shopping items');

      const seenIds = new Set<string>();

      for (const item of alexaItems) {
        seenIds.add(item.id);

        // Skip items already handled by Todoist→Alexa pass
        if (handledIds.has(item.id)) continue;

        const stored = storedMap.get(item.id);

        if (!stored) {
          // New item — only create in Todoist if not already completed in Alexa
          if (!item.completed) {
            const createResult = await this.createItem(item, todoistProjectId, configuredTags);
            if (createResult.success) {
              result.created++;
              if (deleteAfterSync) {
                const deleted = await this.deleteItemFromAlexa(item.id, item.version);
                if (deleted) result.deletedFromSource++;
              }
            } else if (createResult.error) {
              result.errors.push(createResult.error);
            }
          }
          // If already completed in Alexa when first seen, skip (don't create in Todoist)
        } else {
          const itemChanged = hasAlexaShoppingItemChanged(item, stored);
          const storedTags = parseStoredTags(stored.applied_tags);
          const tagsChanged = !tagsEqual(storedTags, configuredTags);

          if (itemChanged || tagsChanged) {
            const updateResult = await this.updateItem(item, stored, todoistProjectId, configuredTags, tagsChanged);
            if (updateResult.success) {
              if (tagsChanged) result.tagsUpdated++;
              if (itemChanged) result.updated++;
            } else if (updateResult.error) {
              result.errors.push(updateResult.error);
            }
          }

          if (deleteAfterSync && stored.todoist_id) {
            this.logger.info(`Deleting previously synced item from Alexa: ${item.value}`);
            const deleted = await this.deleteItemFromAlexa(item.id, item.version);
            if (deleted) result.deletedFromSource++;
          }
        }
      }

      // Detect items truly deleted from Alexa (not just completed)
      for (const stored of storedItems) {
        if (!seenIds.has(stored.alexa_id) && !handledIds.has(stored.alexa_id)) {
          const deleteResult = await this.deleteItem(stored);
          if (deleteResult.success) {
            result.deleted++;
          } else if (deleteResult.error) {
            result.errors.push(deleteResult.error);
          }
        }
      }

      this.logger.info({
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        completed: result.completed,
        deletedFromSource: result.deletedFromSource,
        tagsUpdated: result.tagsUpdated,
        errors: result.errors.length,
      }, 'Alexa shopping list sync completed');

    } catch (error) {
      result.success = false;
      const message = `Alexa shopping list sync failed: ${error}`;
      result.errors.push(message);
      this.logger.error({ err: error }, 'Alexa shopping list sync failed');
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return this.alexaClient.healthCheck();
  }

  private async createItem(
    item: AlexaShoppingItem,
    todoistProjectId: string,
    tags: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const createParams = mapAlexaShoppingToTodoistCreate(item, todoistProjectId);

      if (tags.length > 0) {
        createParams.labels = tags;
      }

      const todoistTask = await this.todoistClient.createTask(createParams);

      // If item is already completed in Alexa, mark it as completed in Todoist
      if (item.completed) {
        await this.todoistClient.completeTask(todoistTask.id);
        this.logger.debug(`Marked new Todoist task as completed: ${item.value}`);
      }

      this.storage.createAlexaShoppingItem({
        alexa_id: item.id,
        alexa_list_id: this.shoppingListId!,
        todoist_id: todoistTask.id,
        value: item.value,
        completed: item.completed ? 1 : 0,
        alexa_updated_at: item.updatedDateTime,
        applied_tags: tags.length > 0 ? JSON.stringify(tags) : null,
      });

      this.logger.debug(`Created Todoist task for shopping item: ${item.value}${tags.length > 0 ? ` with tags: ${tags.join(', ')}` : ''}`);
      return { success: true };
    } catch (error) {
      const message = `Failed to create task for shopping item "${item.value}": ${error}`;
      this.logger.error({ err: error }, message);
      return { success: false, error: message };
    }
  }

  private async updateItem(
    item: AlexaShoppingItem,
    stored: AlexaShoppingItemRecord,
    todoistProjectId: string,
    tags: string[],
    tagsChanged: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!stored.todoist_id) {
        return this.createItem(item, todoistProjectId, tags);
      }

      const updateParams: { content?: string; labels?: string[] } = {
        content: item.value,
      };

      if (tagsChanged) {
        updateParams.labels = tags;
        this.logger.info(`Updated tags for shopping item "${item.value}": ${tags.length > 0 ? tags.join(', ') : '(none)'}`);
      }

      await this.todoistClient.updateTask(stored.todoist_id, updateParams);

      // Handle completion status change
      const itemCompleted = item.completed ? 1 : 0;
      if (itemCompleted !== stored.completed) {
        if (item.completed) {
          await this.todoistClient.completeTask(stored.todoist_id);
          this.logger.debug(`Completed Todoist task for shopping item: ${item.value}`);
        } else {
          await this.todoistClient.reopenTask(stored.todoist_id);
          this.logger.debug(`Reopened Todoist task for shopping item: ${item.value}`);
        }
      }

      this.storage.updateAlexaShoppingItem(item.id, {
        value: item.value,
        completed: itemCompleted,
        alexa_updated_at: item.updatedDateTime,
        applied_tags: tags.length > 0 ? JSON.stringify(tags) : null,
      });

      this.logger.debug(`Updated Todoist task for shopping item: ${item.value}`);
      return { success: true };
    } catch (error) {
      const message = `Failed to update shopping item "${item.value}": ${error}`;
      this.logger.error({ err: error }, message);
      return { success: false, error: message };
    }
  }

  private async deleteItem(stored: AlexaShoppingItemRecord): Promise<{ success: boolean; error?: string }> {
    try {
      if (stored.todoist_id) {
        try {
          await this.todoistClient.deleteTask(stored.todoist_id);
          this.logger.debug(`Deleted Todoist task for removed shopping item: ${stored.value}`);
        } catch (error) {
          this.logger.warn({ err: error }, `Failed to delete Todoist task: ${stored.value}`);
        }
      }

      this.storage.deleteAlexaShoppingItem(stored.alexa_id);

      return { success: true };
    } catch (error) {
      const message = `Failed to delete shopping item "${stored.value}": ${error}`;
      this.logger.error({ err: error }, message);
      return { success: false, error: message };
    }
  }

  private async deleteItemFromAlexa(alexaId: string, version: number): Promise<boolean> {
    try {
      if (!this.shoppingListId) {
        this.logger.warn('Cannot delete item: shopping list ID not set');
        return false;
      }
      await this.alexaClient.deleteListItem(this.shoppingListId, alexaId, version);
      this.storage.deleteAlexaShoppingItem(alexaId);
      this.logger.debug(`Deleted shopping item from Alexa after sync: ${alexaId}`);
      return true;
    } catch (error) {
      this.logger.warn({ err: error }, `Failed to delete shopping item from Alexa: ${alexaId}`);
      return false;
    }
  }
}
