/**
 * Alexa Reminders Source Engine
 *
 * Implements the SourceEngine interface for syncing Alexa reminders to Todoist.
 */

import type { SourceEngine, SyncResult, SourceContext } from '../../core/types.js';
import { createEmptySyncResult, tagsEqual, parseStoredTags } from '../../core/types.js';
import type { AlexaSourceConfig } from './types.js';
import type { Storage, AlexaReminder } from '../../storage.js';
import type { TodoistClient } from '../../clients/todoist.js';
import type { Logger } from '../../utils/logger.js';
import { AlexaAuth } from './auth.js';
import { AlexaClient, type AlexaReminderItem } from './client.js';
import { mapAlexaReminderToTodoistCreate, hasAlexaReminderChanged } from './mapper.js';

export class AlexaRemindersSource implements SourceEngine {
  readonly sourceId = 'alexa-reminders';
  readonly sourceName = 'Alexa Reminders';

  private config: AlexaSourceConfig;
  private logger: Logger;
  private storage: Storage;
  private alexaClient: AlexaClient;
  private todoistClient: TodoistClient;

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
   * Factory method to create an Alexa Reminders source
   */
  static async create(
    config: AlexaSourceConfig,
    context: SourceContext,
    alexaClient?: AlexaClient
  ): Promise<AlexaRemindersSource | null> {
    if (!config.enabled || config.lists.length === 0) {
      context.logger.info('Alexa Reminders source disabled or no lists configured');
      return null;
    }

    context.logger.info('Initializing Alexa Reminders source...');

    let client = alexaClient;
    if (!client) {
      try {
        const alexaAuth = new AlexaAuth(config, context.logger);
        const alexaRemote = await alexaAuth.getAuthenticatedClient();
        client = new AlexaClient(alexaRemote, context.logger);
      } catch (error) {
        if (config.fail_silently) {
          context.logger.error({ err: error }, 'Failed to initialize Alexa Reminders (continuing without it)');
          return null;
        }
        throw error;
      }
    }

    context.logger.info('Alexa Reminders source initialized');

    return new AlexaRemindersSource(
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
      this.logger.info('Starting Alexa reminder sync...');

      const mapping = this.config.lists[0];
      const configuredProjectId = mapping.todoist_project_id;
      const configuredTags = mapping.tags || [];

      if (!configuredProjectId) {
        throw new Error('No todoist_project_id configured for Alexa reminders');
      }

      const todoistProjectId = await this.todoistClient.resolveProjectId(configuredProjectId);

      // Fetch ALL reminders (ON and OFF) so we can detect dismiss → complete, not just delete
      const allAlexaReminders = await this.alexaClient.getReminders();

      // Get stored reminders
      const storedReminders = this.storage.getAllAlexaReminders();
      const storedMap = new Map(storedReminders.map((r) => [r.alexa_id, r]));

      // Todoist→Alexa: delete Alexa reminders whose paired Todoist task was completed/deleted
      const activeTodoistIds = await this.todoistClient.getTaskIdsForProjects([todoistProjectId]);
      const handledIds = new Set<string>();

      for (const stored of storedReminders) {
        if (stored.todoist_id && !activeTodoistIds.has(stored.todoist_id)) {
          try {
            await this.alexaClient.deleteReminder(stored.alexa_id);
          } catch {
            // reminder may already be gone from Alexa
          }
          this.storage.deleteAlexaReminder(stored.alexa_id);
          handledIds.add(stored.alexa_id);
          this.logger.debug(`Dismissed Alexa reminder (Todoist task completed): ${stored.title}`);
        }
      }

      this.logger.debug({
        alexaReminderCount: allAlexaReminders.length,
        storedReminderCount: storedReminders.length,
        todoistCompletedCount: handledIds.size,
        deleteAfterSync: mapping.delete_after_sync,
      }, 'Syncing Alexa reminders');

      const seenIds = new Set<string>();

      for (const reminder of allAlexaReminders) {
        seenIds.add(reminder.id);

        // Skip reminders already handled by Todoist→Alexa pass above
        if (handledIds.has(reminder.id)) continue;

        const stored = storedMap.get(reminder.id);

        if (!stored) {
          // New reminder — only create in Todoist if it's still active
          if (reminder.status === 'ON') {
            const createResult = await this.createReminder(reminder, todoistProjectId, configuredTags);
            if (createResult.success) {
              result.created++;
              if (mapping.delete_after_sync) {
                const deleted = await this.deleteReminderFromAlexa(reminder.id);
                if (deleted) result.deletedFromSource++;
              }
            } else if (createResult.error) {
              result.errors.push(createResult.error);
            }
          }
          // If status is already OFF (already dismissed), skip — don't create in Todoist
        } else {
          // Existing paired reminder
          const statusChanged = reminder.status !== stored.status;
          const reminderChanged = hasAlexaReminderChanged(reminder, stored);
          const storedTags = parseStoredTags(stored.applied_tags);
          const tagsChanged = !tagsEqual(storedTags, configuredTags);

          // Alexa→Todoist status sync
          if (statusChanged && stored.todoist_id) {
            if (reminder.status === 'OFF') {
              // Reminder was dismissed in Alexa → complete Todoist task
              try {
                await this.todoistClient.completeTask(stored.todoist_id);
                result.completed++;
                this.logger.debug(`Completed Todoist task (Alexa reminder dismissed): ${reminder.reminderLabel}`);
              } catch (e) {
                this.logger.warn({ err: e }, `Failed to complete Todoist task: ${reminder.reminderLabel}`);
              }
            } else {
              // Reminder re-enabled in Alexa → reopen Todoist task
              try {
                await this.todoistClient.reopenTask(stored.todoist_id);
                this.logger.debug(`Reopened Todoist task (Alexa reminder re-enabled): ${reminder.reminderLabel}`);
              } catch (e) {
                this.logger.warn({ err: e }, `Failed to reopen Todoist task: ${reminder.reminderLabel}`);
              }
            }
          }

          // Content/tag updates (only for active reminders)
          if ((reminderChanged || tagsChanged) && reminder.status === 'ON') {
            const updateResult = await this.updateReminder(reminder, stored, todoistProjectId, configuredTags, tagsChanged);
            if (updateResult.success) {
              if (tagsChanged) result.tagsUpdated++;
              if (reminderChanged && !statusChanged) result.updated++;
            } else if (updateResult.error) {
              result.errors.push(updateResult.error);
            }
          }

          // Persist status/content changes to storage
          if (statusChanged || reminderChanged || tagsChanged) {
            this.storage.updateAlexaReminder(reminder.id, {
              title: reminder.reminderLabel,
              reminder_time: reminder.reminderTime,
              status: reminder.status,
              device_name: reminder.deviceName,
              alexa_updated_at: reminder.updatedDate,
              applied_tags: configuredTags.length > 0 ? JSON.stringify(configuredTags) : null,
            });
          }

          if (mapping.delete_after_sync && stored.todoist_id) {
            this.logger.info(`Deleting previously synced reminder from Alexa: ${reminder.reminderLabel}`);
            const deleted = await this.deleteReminderFromAlexa(reminder.id);
            if (deleted) result.deletedFromSource++;
          }
        }
      }

      // Detect reminders truly deleted from Alexa (not dismissed, not handled above)
      for (const stored of storedReminders) {
        if (!seenIds.has(stored.alexa_id) && !handledIds.has(stored.alexa_id)) {
          const deleteResult = await this.deleteReminder(stored);
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
      }, 'Alexa reminder sync completed');

    } catch (error) {
      result.success = false;
      const message = `Alexa reminder sync failed: ${error}`;
      result.errors.push(message);
      this.logger.error({ err: error }, 'Alexa reminder sync failed');
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return this.alexaClient.healthCheck();
  }

  private async createReminder(
    reminder: AlexaReminderItem,
    todoistProjectId: string,
    tags: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const createParams = mapAlexaReminderToTodoistCreate(reminder, todoistProjectId);

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
        return this.createReminder(reminder, todoistProjectId, tags);
      }

      const updateParams: { content?: string; dueDate?: string; labels?: string[] } = {
        content: reminder.reminderLabel,
        dueDate: reminder.reminderTime ? reminder.reminderTime.split('T')[0] : undefined,
      };

      if (tagsChanged) {
        updateParams.labels = tags;
        this.logger.info(`Updated tags for reminder "${reminder.reminderLabel}": ${tags.length > 0 ? tags.join(', ') : '(none)'}`);
      }

      await this.todoistClient.updateTask(stored.todoist_id, updateParams);

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
      if (stored.todoist_id) {
        try {
          await this.todoistClient.deleteTask(stored.todoist_id);
          this.logger.debug(`Deleted Todoist task for removed reminder: ${stored.title}`);
        } catch (error) {
          this.logger.warn({ err: error }, `Failed to delete Todoist task: ${stored.title}`);
        }
      }

      this.storage.deleteAlexaReminder(stored.alexa_id);

      return { success: true };
    } catch (error) {
      const message = `Failed to delete reminder "${stored.title}": ${error}`;
      this.logger.error({ err: error }, message);
      return { success: false, error: message };
    }
  }

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
}
