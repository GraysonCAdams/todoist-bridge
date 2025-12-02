import type { AlexaShoppingItem } from '../clients/alexa.js';
import type { CreateTaskParams } from '../clients/todoist.js';
import type { AlexaShoppingItemRecord } from '../storage.js';
import { parseISO, isValid } from 'date-fns';

/**
 * Maps an Alexa shopping item to Todoist task creation parameters
 */
export function mapAlexaShoppingToTodoistCreate(
  item: AlexaShoppingItem,
  projectId: string
): CreateTaskParams {
  const params: CreateTaskParams = {
    content: item.value || 'Shopping Item',
    projectId,
  };

  return params;
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

  // Compare completed status
  const itemCompleted = item.completed ? 1 : 0;
  if (itemCompleted !== stored.completed) return true;

  return false;
}
