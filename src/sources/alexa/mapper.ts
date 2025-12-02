/**
 * Alexa to Todoist Mapping Functions
 */

import type { AlexaReminderItem, AlexaShoppingItem } from './client.js';
import type { CreateTaskParams } from '../../clients/todoist.js';
import type { AlexaReminder, AlexaShoppingItemRecord } from '../../storage.js';
import { parseISO, format, isValid } from 'date-fns';

/**
 * Maps an Alexa reminder to Todoist task creation parameters
 */
export function mapAlexaReminderToTodoistCreate(
  reminder: AlexaReminderItem,
  projectId: string
): CreateTaskParams {
  const params: CreateTaskParams = {
    content: reminder.reminderLabel || 'Alexa Reminder',
    projectId,
  };

  // Add device info as description
  if (reminder.deviceName) {
    params.description = `From Alexa device: ${reminder.deviceName}`;
  }

  // Parse reminder time for due date
  if (reminder.reminderTime) {
    const dueDateTime = extractDateTime(reminder.reminderTime);
    if (dueDateTime) {
      // Todoist accepts datetime strings in format "YYYY-MM-DD" or "YYYY-MM-DD HH:mm"
      params.dueDate = dueDateTime;
    }
  }

  return params;
}

/**
 * Maps an Alexa shopping item to Todoist task creation parameters
 */
export function mapAlexaShoppingToTodoistCreate(
  item: AlexaShoppingItem,
  projectId: string
): CreateTaskParams {
  return {
    content: item.value,
    projectId,
  };
}

/**
 * Check if an Alexa reminder has changed since the last sync
 */
export function hasAlexaReminderChanged(
  reminder: AlexaReminderItem,
  stored: AlexaReminder
): boolean {
  // Compare updated timestamps if available
  if (reminder.updatedDate && stored.alexa_updated_at) {
    try {
      const remoteUpdated = parseISO(reminder.updatedDate);
      const storedUpdated = parseISO(stored.alexa_updated_at);
      if (isValid(remoteUpdated) && isValid(storedUpdated)) {
        return remoteUpdated > storedUpdated;
      }
    } catch {
      // Fall through to field comparison
    }
  }

  // Field comparison fallback
  if (reminder.reminderLabel !== stored.title) return true;
  if (reminder.status !== stored.status) return true;

  // Compare reminder times
  const newReminderTime = reminder.reminderTime || null;
  if (newReminderTime !== stored.reminder_time) return true;

  return false;
}

/**
 * Check if an Alexa shopping item has changed since the last sync
 */
export function hasAlexaShoppingItemChanged(
  item: AlexaShoppingItem,
  stored: AlexaShoppingItemRecord
): boolean {
  // Compare updated timestamps if available
  if (item.updatedDateTime && stored.alexa_updated_at) {
    try {
      const remoteUpdated = parseISO(item.updatedDateTime);
      const storedUpdated = parseISO(stored.alexa_updated_at);
      if (isValid(remoteUpdated) && isValid(storedUpdated)) {
        return remoteUpdated > storedUpdated;
      }
    } catch {
      // Fall through to field comparison
    }
  }

  // Field comparison fallback
  if (item.value !== stored.value) return true;

  const itemCompleted = item.completed ? 1 : 0;
  if (itemCompleted !== stored.completed) return true;

  return false;
}

/**
 * Extract datetime string suitable for Todoist from an ISO string
 * Todoist prefers "YYYY-MM-DD HH:mm" format for datetime, or just "YYYY-MM-DD" for date-only
 */
function extractDateTime(dateString: string): string | null {
  try {
    const date = parseISO(dateString);
    if (!isValid(date)) {
      return null;
    }

    // Format as "YYYY-MM-DD HH:mm" for Todoist
    // This preserves the time component from Alexa reminders
    return format(date, 'yyyy-MM-dd HH:mm');
  } catch {
    // If parsing fails, try to extract date directly
    const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
}

/**
 * Extract just the date part from a datetime string
 */
export function extractDateOnly(dateString: string): string | null {
  try {
    const date = parseISO(dateString);
    if (!isValid(date)) {
      return null;
    }
    return format(date, 'yyyy-MM-dd');
  } catch {
    const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
}
