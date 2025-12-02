import type { Config, SyncMapping } from '../config.js';
import type { Logger } from '../utils/logger.js';
import type { Storage, AlexaReminder } from '../storage.js';
import type { AlexaClient, AlexaReminderItem } from '../clients/alexa.js';
import type { TodoistClient } from '../clients/todoist.js';
import { mapAlexaToTodoistCreate, hasAlexaReminderChanged } from './alexa-mapper.js';

export interface AlexaSyncResult {
  success: boolean;
  remindersCreated: number;
  remindersUpdated: number;
  remindersDeleted: number;
  remindersDeletedFromAlexa: number;
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

export class AlexaSyncEngine {
  private config: Config;
  private logger: Logger;
  private storage: Storage;
  private alexaClient: AlexaClient;
  private todoistClient: TodoistClient;

  constructor(
    config: Config,
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

  async sync(): Promise<AlexaSyncResult> {
    const result: AlexaSyncResult = {
      success: true,
      remindersCreated: 0,
      remindersUpdated: 0,
      remindersDeleted: 0,
      remindersDeletedFromAlexa: 0,
      tagsUpdated: 0,
      errors: [],
    };

    try {
      this.logger.info('Starting Alexa reminder sync...');

      // Clean up stale cache entries before sync
      await this.cleanupStaleCache();

      // Get configured list mappings for Alexa
      const alexaLists = this.config.sources.alexa.lists;
      if (alexaLists.length === 0) {
        this.logger.warn('No Alexa list mappings configured');
        return result;
      }

      // For Alexa, we use "all" as source_list_id since all reminders go to one project
      // Get the first mapping (Alexa only has one "list" - all reminders)
      const mapping = alexaLists[0];
      const configuredProjectId = mapping.todoist_project_id;
      const configuredTags = mapping.tags || [];

      if (!configuredProjectId) {
        throw new Error('No todoist_project_id configured for Alexa reminders');
      }

      // Resolve special project IDs like "inbox"
      const todoistProjectId = await this.todoistClient.resolveProjectId(configuredProjectId);

      // Get current reminders from Alexa
      const alexaReminders = await this.alexaClient.getReminders();

      // Filter by status if configured
      const includeCompleted = mapping.include_completed;
      const activeReminders = includeCompleted
        ? alexaReminders
        : alexaReminders.filter((r) => r.status === 'ON');

      // Get stored reminders
      const storedReminders = this.storage.getAllAlexaReminders();
      const storedMap = new Map(storedReminders.map((r) => [r.alexa_id, r]));

      this.logger.debug({
        alexaReminderCount: activeReminders.length,
        storedReminderCount: storedReminders.length,
        deleteAfterSync: mapping.delete_after_sync,
      }, 'Syncing Alexa reminders');

      // Track seen IDs for deletion detection
      const seenIds = new Set<string>();

      // Process each reminder
      for (const reminder of activeReminders) {
        seenIds.add(reminder.id);
        const stored = storedMap.get(reminder.id);

        if (!stored) {
          // New reminder - create in Todoist
          const createResult = await this.createReminder(reminder, todoistProjectId, configuredTags);
          if (createResult.success) {
            result.remindersCreated++;
            // Delete from Alexa if configured
            if (mapping.delete_after_sync) {
              const deleted = await this.deleteReminderFromAlexa(reminder.id);
              if (deleted) {
                result.remindersDeletedFromAlexa++;
              }
            }
          } else if (createResult.error) {
            result.errors.push(createResult.error);
          }
        } else {
          const reminderChanged = hasAlexaReminderChanged(reminder, stored);
          const storedTags = parseStoredTags(stored.applied_tags);
          const tagsChanged = !tagsEqual(storedTags, configuredTags);

          if (reminderChanged || tagsChanged) {
            // Reminder or tags changed - update in Todoist
            const updateResult = await this.updateReminder(reminder, stored, todoistProjectId, configuredTags, tagsChanged);
            if (updateResult.success) {
              if (tagsChanged) {
                result.tagsUpdated++;
              }
              if (reminderChanged) {
                result.remindersUpdated++;
              }
            } else if (updateResult.error) {
              result.errors.push(updateResult.error);
            }
          }

          // Delete previously synced reminder from Alexa if delete_after_sync is enabled
          // This handles reminders that were synced before the option was turned on
          if (mapping.delete_after_sync && stored.todoist_id) {
            this.logger.info(`Deleting previously synced reminder from Alexa: ${reminder.reminderLabel}`);
            const deleted = await this.deleteReminderFromAlexa(reminder.id);
            if (deleted) {
              result.remindersDeletedFromAlexa++;
            }
          }
        }
      }

      // Detect deletions - reminders that were in storage but not in Alexa anymore
      for (const stored of storedReminders) {
        if (!seenIds.has(stored.alexa_id)) {
          const deleteResult = await this.deleteReminder(stored);
          if (deleteResult.success) {
            result.remindersDeleted++;
          } else if (deleteResult.error) {
            result.errors.push(deleteResult.error);
          }
        }
      }

      this.logger.info({
        created: result.remindersCreated,
        updated: result.remindersUpdated,
        deleted: result.remindersDeleted,
        deletedFromAlexa: result.remindersDeletedFromAlexa,
        tagsUpdated: result.tagsUpdated,
        errors: result.errors.length,
      }, 'Alexa sync completed');

    } catch (error) {
      result.success = false;
      const message = `Alexa sync failed: ${error}`;
      result.errors.push(message);
      this.logger.error({ err: error }, 'Alexa sync failed');
    }

    return result;
  }

  /**
   * Clean up stale cache entries for reminders that no longer exist in Todoist
   * This prevents 404 errors when trying to update deleted tasks
   */
  private async cleanupStaleCache(): Promise<void> {
    try {
      // Get all configured Todoist project IDs for Alexa
      const rawProjectIds = this.config.sources.alexa.lists
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

      // Remove stale reminders from cache
      const removed = this.storage.cleanupStaleAlexaReminders(validTodoistIds);

      if (removed > 0) {
        this.logger.info(`Cleaned up ${removed} stale Alexa reminder(s) from cache`);
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to clean up stale Alexa cache entries');
    }
  }

  private async createReminder(reminder: AlexaReminderItem, todoistProjectId: string, tags: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      const createParams = mapAlexaToTodoistCreate(reminder, todoistProjectId);

      // Add configured tags
      if (tags.length > 0) {
        createParams.labels = tags;
      }

      const todoistTask = await this.todoistClient.createTask(createParams);

      // If reminder is already completed (OFF) in Alexa, mark it as completed in Todoist
      if (reminder.status === 'OFF') {
        await this.todoistClient.completeTask(todoistTask.id);
        this.logger.debug(`Marked new Todoist task as completed: ${reminder.reminderLabel}`);
      }

      this.storage.createAlexaReminder({
        alexa_id: reminder.id,
        todoist_id: todoistTask.id,
        title: reminder.reminderLabel,
        reminder_time: reminder.reminderTime,
        status: reminder.status,
        device_name: reminder.deviceName,
        alexa_updated_at: reminder.updatedDate,
        applied_tags: tags.length > 0 ? JSON.stringify(tags) : null,
      });

      this.logger.debug(`Created Todoist task for reminder: ${reminder.reminderLabel}${tags.length > 0 ? ` with tags: ${tags.join(', ')}` : ''}`);
      return { success: true };
    } catch (error) {
      const message = `Failed to create task for reminder "${reminder.reminderLabel}": ${error}`;
      this.logger.error({ err: error }, message);
      return { success: false, error: message };
    }
  }

  private async updateReminder(
    reminder: AlexaReminderItem,
    stored: AlexaReminder,
    todoistProjectId: string,
    tags: string[],
    tagsChanged: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!stored.todoist_id) {
        // No Todoist task exists, create one
        return this.createReminder(reminder, todoistProjectId, tags);
      }

      // Build update params
      const updateParams: { content?: string; dueDate?: string; labels?: string[] } = {
        content: reminder.reminderLabel,
        dueDate: reminder.reminderTime ? reminder.reminderTime.split('T')[0] : undefined,
      };

      // Add labels if tags changed
      if (tagsChanged) {
        updateParams.labels = tags;
        this.logger.info(`Updated tags for reminder "${reminder.reminderLabel}": ${tags.length > 0 ? tags.join(', ') : '(none)'}`);
      }

      // Update the Todoist task
      await this.todoistClient.updateTask(stored.todoist_id, updateParams);

      // Update storage
      this.storage.updateAlexaReminder(reminder.id, {
        title: reminder.reminderLabel,
        reminder_time: reminder.reminderTime,
        status: reminder.status,
        device_name: reminder.deviceName,
        alexa_updated_at: reminder.updatedDate,
        applied_tags: tags.length > 0 ? JSON.stringify(tags) : null,
      });

      this.logger.debug(`Updated Todoist task for reminder: ${reminder.reminderLabel}`);
      return { success: true };
    } catch (error) {
      const message = `Failed to update reminder "${reminder.reminderLabel}": ${error}`;
      this.logger.error({ err: error }, message);
      return { success: false, error: message };
    }
  }

  private async deleteReminder(stored: AlexaReminder): Promise<{ success: boolean; error?: string }> {
    try {
      // Delete from Todoist if we have a task ID
      if (stored.todoist_id) {
        try {
          await this.todoistClient.deleteTask(stored.todoist_id);
          this.logger.debug(`Deleted Todoist task for removed reminder: ${stored.title}`);
        } catch (error) {
          // Task might already be deleted, log but continue
          this.logger.warn({ err: error }, `Failed to delete Todoist task: ${stored.title}`);
        }
      }

      // Remove from storage
      this.storage.deleteAlexaReminder(stored.alexa_id);

      return { success: true };
    } catch (error) {
      const message = `Failed to delete reminder "${stored.title}": ${error}`;
      this.logger.error({ err: error }, message);
      return { success: false, error: message };
    }
  }

  /**
   * Delete a reminder from Alexa after syncing
   * Returns true if deletion was successful
   */
  private async deleteReminderFromAlexa(alexaId: string): Promise<boolean> {
    try {
      await this.alexaClient.deleteReminder(alexaId);
      this.storage.deleteAlexaReminder(alexaId);
      this.logger.debug(`Deleted reminder from Alexa after sync: ${alexaId}`);
      return true;
    } catch (error) {
      this.logger.warn({ err: error }, `Failed to delete reminder from Alexa: ${alexaId}`);
      return false;
    }
  }

  /**
   * Check if the Alexa client is healthy
   */
  async healthCheck(): Promise<boolean> {
    return this.alexaClient.healthCheck();
  }
}
