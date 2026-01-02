/**
 * Mapper functions for bi-directional sync between Microsoft To-Do and Todoist
 */

import { createHash } from 'crypto';
import type { MicrosoftTodoItemRecord } from '../../storage.js';
import type {
  MicrosoftTodoTask,
  CreateMicrosoftTaskParams,
  MicrosoftSourceConfig,
} from './types.js';

/**
 * Parameters for creating a Todoist task
 */
export interface TodoistTaskCreate {
  content: string;
  description?: string;
  projectId: string;
  dueDate?: string;
  labels?: string[];
}

/**
 * Parameters for updating a Todoist task
 */
export interface TodoistTaskUpdate {
  content?: string;
  description?: string;
  dueDate?: string | null;
  labels?: string[];
}

/**
 * Todoist task as returned by API
 */
export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string;
  isCompleted: boolean;
  due?: {
    date: string;
    datetime?: string;
  };
  labels: string[];
}

/**
 * Generate a content hash for change detection
 * Used since Todoist REST API doesn't expose modification timestamps
 */
export function generateContentHash(
  title: string,
  body: string | null | undefined,
  status: string,
  dueDate: string | null | undefined
): string {
  const content = JSON.stringify({
    title: title || '',
    body: body || '',
    status: status || '',
    dueDate: dueDate || '',
  });
  return createHash('md5').update(content).digest('hex');
}

/**
 * Map Microsoft To-Do task to Todoist create parameters
 */
export function mapMicrosoftToTodoistCreate(
  msTask: MicrosoftTodoTask,
  projectId: string,
  tags: string[]
): TodoistTaskCreate {
  const params: TodoistTaskCreate = {
    content: msTask.title,
    projectId,
  };

  // Map body/notes
  if (msTask.body?.content) {
    params.description = msTask.body.content;
  }

  // Map due date
  if (msTask.dueDateTime?.dateTime) {
    // Extract date part (YYYY-MM-DD) from ISO datetime
    params.dueDate = msTask.dueDateTime.dateTime.split('T')[0];
  }

  // Apply tags
  if (tags.length > 0) {
    params.labels = tags;
  }

  return params;
}

/**
 * Map Microsoft To-Do task to Todoist update parameters
 */
export function mapMicrosoftToTodoistUpdate(
  msTask: MicrosoftTodoTask,
  stored: MicrosoftTodoItemRecord,
  tags: string[]
): TodoistTaskUpdate {
  const updates: TodoistTaskUpdate = {};

  // Update title if changed
  if (msTask.title !== stored.title) {
    updates.content = msTask.title;
  }

  // Update body if changed
  const newBody = msTask.body?.content || null;
  if (newBody !== stored.body) {
    updates.description = newBody || '';
  }

  // Update due date if changed
  const newDueDate = msTask.dueDateTime?.dateTime?.split('T')[0] || null;
  if (newDueDate !== stored.due_date) {
    updates.dueDate = newDueDate;
  }

  // Always include labels for potential tag updates
  if (tags.length > 0) {
    updates.labels = tags;
  }

  return updates;
}

/**
 * Map Todoist task to Microsoft To-Do create parameters
 */
export function mapTodoistToMicrosoftCreate(
  todoistTask: TodoistTask,
  config: MicrosoftSourceConfig
): CreateMicrosoftTaskParams {
  const params: CreateMicrosoftTaskParams = {
    title: todoistTask.content,
  };

  // Map description to body
  if (todoistTask.description) {
    params.body = {
      content: todoistTask.description,
      contentType: 'text',
    };
  }

  // Map due date
  if (todoistTask.due?.date) {
    // Convert YYYY-MM-DD to ISO datetime
    const dueDate = new Date(todoistTask.due.date);
    params.dueDateTime = {
      dateTime: dueDate.toISOString(),
      timeZone: 'UTC',
    };
  }

  // Set reminder if task has a specific time and we're assigning to self
  if (config.assign_to_self && todoistTask.due?.datetime) {
    params.reminderDateTime = {
      dateTime: todoistTask.due.datetime,
      timeZone: 'UTC',
    };
    params.isReminderOn = true;
  }

  return params;
}

/**
 * Check if Microsoft task has changed compared to stored record
 * Uses lastModifiedDateTime for comparison
 */
export function hasMicrosoftTaskChanged(
  msTask: MicrosoftTodoTask,
  stored: MicrosoftTodoItemRecord
): boolean {
  // Primary: Compare modification timestamps
  if (msTask.lastModifiedDateTime && stored.microsoft_modified_at) {
    const msModified = new Date(msTask.lastModifiedDateTime).getTime();
    const storedModified = new Date(stored.microsoft_modified_at).getTime();
    return msModified > storedModified;
  }

  // Fallback: Compare content hash
  const newHash = generateContentHash(
    msTask.title,
    msTask.body?.content,
    msTask.status,
    msTask.dueDateTime?.dateTime?.split('T')[0]
  );
  return newHash !== stored.content_hash;
}

/**
 * Check if Todoist task has changed compared to stored record
 * Since Todoist REST API doesn't expose timestamps, we use content hash
 */
export function hasTodoistTaskChanged(
  todoistTask: TodoistTask,
  stored: MicrosoftTodoItemRecord
): boolean {
  // Compare content hash
  const status = todoistTask.isCompleted ? 'completed' : 'notStarted';
  const newHash = generateContentHash(
    todoistTask.content,
    todoistTask.description,
    status,
    todoistTask.due?.date
  );
  return newHash !== stored.content_hash;
}

/**
 * Determine which platform wins in a conflict (last write wins)
 * Returns 'microsoft' or 'todoist' or 'none' (no conflict)
 */
export function resolveConflict(
  msTask: MicrosoftTodoTask,
  todoistTask: TodoistTask,
  stored: MicrosoftTodoItemRecord
): 'microsoft' | 'todoist' | 'none' {
  const msChanged = hasMicrosoftTaskChanged(msTask, stored);
  const todoistChanged = hasTodoistTaskChanged(todoistTask, stored);

  // No changes on either side
  if (!msChanged && !todoistChanged) {
    return 'none';
  }

  // Only one side changed
  if (msChanged && !todoistChanged) {
    return 'microsoft';
  }
  if (!msChanged && todoistChanged) {
    return 'todoist';
  }

  // Both sides changed - use last_write_wins
  // Microsoft provides timestamps, Todoist doesn't
  // So we use Microsoft's timestamp if available, otherwise assume Todoist is newer
  // (since we're detecting Todoist change via hash, it must have changed since last sync)
  if (msTask.lastModifiedDateTime && stored.todoist_modified_at) {
    const msModified = new Date(msTask.lastModifiedDateTime).getTime();
    const todoistModified = new Date(stored.todoist_modified_at).getTime();
    return msModified > todoistModified ? 'microsoft' : 'todoist';
  }

  // If we can't determine, prefer the newer sync source (Todoist since it was just fetched)
  return 'todoist';
}

/**
 * Check if completion status differs between Microsoft and Todoist
 */
export function hasCompletionStatusChanged(
  msTask: MicrosoftTodoTask,
  todoistTask: TodoistTask
): { differs: boolean; microsoftCompleted: boolean; todoistCompleted: boolean } {
  const microsoftCompleted = msTask.status === 'completed';
  const todoistCompleted = todoistTask.isCompleted;

  return {
    differs: microsoftCompleted !== todoistCompleted,
    microsoftCompleted,
    todoistCompleted,
  };
}

/**
 * Create storage record from Microsoft task
 */
export function createStoredRecordFromMicrosoft(
  msTask: MicrosoftTodoTask,
  listId: string,
  todoistId: string | null,
  tags: string[]
): Omit<MicrosoftTodoItemRecord, 'id' | 'synced_at'> {
  const dueDate = msTask.dueDateTime?.dateTime?.split('T')[0] || null;

  return {
    microsoft_id: msTask.id,
    microsoft_list_id: listId,
    todoist_id: todoistId,
    title: msTask.title,
    body: msTask.body?.content || null,
    status: msTask.status,
    due_date: dueDate,
    microsoft_modified_at: msTask.lastModifiedDateTime,
    todoist_modified_at: new Date().toISOString(),
    applied_tags: JSON.stringify(tags),
    content_hash: generateContentHash(
      msTask.title,
      msTask.body?.content,
      msTask.status,
      dueDate
    ),
  };
}

/**
 * Create storage record from Todoist task
 */
export function createStoredRecordFromTodoist(
  todoistTask: TodoistTask,
  microsoftId: string,
  listId: string,
  tags: string[]
): Omit<MicrosoftTodoItemRecord, 'id' | 'synced_at'> {
  const status = todoistTask.isCompleted ? 'completed' : 'notStarted';
  const dueDate = todoistTask.due?.date || null;

  return {
    microsoft_id: microsoftId,
    microsoft_list_id: listId,
    todoist_id: todoistTask.id,
    title: todoistTask.content,
    body: todoistTask.description || null,
    status,
    due_date: dueDate,
    microsoft_modified_at: new Date().toISOString(),
    todoist_modified_at: new Date().toISOString(),
    applied_tags: JSON.stringify(tags),
    content_hash: generateContentHash(
      todoistTask.content,
      todoistTask.description,
      status,
      dueDate
    ),
  };
}
