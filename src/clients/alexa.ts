import type AlexaRemote from 'alexa-remote2';
import type { Notification, ListItemOptions } from 'alexa-remote2';
import type { Logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

/**
 * Extended notification with device name (which we add after fetching)
 */
export interface AlexaNotification extends Notification {
  deviceName?: string;
  lastUpdatedDate?: number;
}

/**
 * Simplified reminder representation for sync operations
 */
export interface AlexaReminderItem {
  id: string;
  reminderLabel: string;
  reminderTime: string | null;
  status: 'ON' | 'OFF';
  deviceSerialNumber: string | null;
  deviceName: string | null;
  createdDate: string | null;
  updatedDate: string | null;
}

/**
 * Alexa list metadata (shopping list, to-do list, etc.)
 */
export interface AlexaList {
  listId: string;
  name: string;
  listType: string; // "SHOP", "TODO", etc.
  defaultList: boolean;
  itemCount: number;
}

/**
 * Shopping list item from Alexa
 */
export interface AlexaShoppingItem {
  id: string;
  value: string;
  completed: boolean;
  createdDateTime: string | null;
  updatedDateTime: string | null;
  version: number;
}

export class AlexaClient {
  private alexa: AlexaRemote;
  private logger: Logger;

  constructor(alexa: AlexaRemote, logger: Logger) {
    this.alexa = alexa;
    this.logger = logger;
  }

  /**
   * Get all reminders from Alexa
   */
  async getReminders(): Promise<AlexaReminderItem[]> {
    return withRetry(
      () => this.fetchReminders(),
      this.logger,
      'getAlexaReminders'
    );
  }

  private fetchReminders(): Promise<AlexaReminderItem[]> {
    return new Promise((resolve, reject) => {
      // getNotifications requires (cached: boolean, callback)
      // The callback type is generic, so we need to cast the result
      this.alexa.getNotifications(false, ((err: Error | undefined, result: { notifications?: Notification[] } | undefined) => {
        if (err) {
          this.logger.error({ err }, 'Failed to fetch Alexa notifications');
          reject(err);
          return;
        }

        if (!result || !result.notifications) {
          this.logger.debug('No notifications found');
          resolve([]);
          return;
        }

        // Filter to only reminders (not alarms, timers, etc.)
        const reminders = (result.notifications as AlexaNotification[])
          .filter((n) => n.type === 'Reminder')
          .map((n): AlexaReminderItem => ({
            id: n.id || n.notificationIndex || '',
            reminderLabel: n.reminderLabel || 'Alexa Reminder',
            reminderTime: n.alarmTime ? new Date(n.alarmTime).toISOString() : null,
            status: n.status || 'ON',
            deviceSerialNumber: n.deviceSerialNumber || null,
            deviceName: n.deviceName || null,
            createdDate: n.createdDate ? new Date(n.createdDate).toISOString() : null,
            updatedDate: n.lastUpdatedDate ? new Date(n.lastUpdatedDate).toISOString() : null,
          }));

        this.logger.debug(`Found ${reminders.length} Alexa reminders`);
        resolve(reminders);
      }) as Parameters<typeof this.alexa.getNotifications>[1]);
    });
  }

  /**
   * Get all notifications (including alarms, timers, reminders)
   */
  async getAllNotifications(): Promise<AlexaNotification[]> {
    return new Promise((resolve, reject) => {
      this.alexa.getNotifications(false, ((err: Error | undefined, result: { notifications?: Notification[] } | undefined) => {
        if (err) {
          reject(err);
          return;
        }
        resolve((result?.notifications as AlexaNotification[]) || []);
      }) as Parameters<typeof this.alexa.getNotifications>[1]);
    });
  }

  /**
   * Delete a notification/reminder by ID
   * Note: alexa-remote2 requires a Notification object with at least { id } set
   */
  async deleteReminder(notificationId: string): Promise<void> {
    return withRetry(
      () => this.doDeleteReminder(notificationId),
      this.logger,
      'deleteAlexaReminder'
    );
  }

  private doDeleteReminder(notificationId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // alexa-remote2 deleteNotification requires a Notification object
      const notification = { id: notificationId } as Notification;
      this.alexa.deleteNotification(notification, (err) => {
        if (err) {
          this.logger.error({ err, notificationId }, 'Failed to delete Alexa notification');
          reject(err);
          return;
        }
        this.logger.debug(`Deleted Alexa notification: ${notificationId}`);
        resolve();
      });
    });
  }

  /**
   * Get list of Alexa devices
   */
  async getDevices(): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      this.alexa.getDevices((err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve((result as unknown[]) || []);
      });
    });
  }

  /**
   * Check if the client is connected and functional
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.getDevices();
      return true;
    } catch {
      return false;
    }
  }

  // ============ Shopping List Methods ============

  /**
   * Get all Alexa lists (shopping, to-do, custom)
   */
  async getLists(): Promise<AlexaList[]> {
    return withRetry(
      () => this.fetchLists(),
      this.logger,
      'getAlexaLists'
    );
  }

  private fetchLists(): Promise<AlexaList[]> {
    return new Promise((resolve, reject) => {
      this.alexa.getListsV2((err, result) => {
        if (err) {
          this.logger.error({ err }, 'Failed to fetch Alexa lists');
          reject(err);
          return;
        }

        // Log raw result for debugging
        this.logger.debug({ rawResult: result }, 'Raw getListsV2 response');

        // getListsV2 returns the listInfoList array directly (the library extracts it)
        // But we also handle the case where it returns the full response object
        let listArray: Record<string, unknown>[];
        if (Array.isArray(result)) {
          listArray = result as Record<string, unknown>[];
        } else {
          const typedResult = result as {
            lists?: Record<string, unknown>[];
            listInfoList?: Record<string, unknown>[];
          } | undefined;
          listArray = typedResult?.listInfoList || typedResult?.lists || [];
        }

        if (listArray.length === 0) {
          this.logger.debug('No lists found in response');
          resolve([]);
          return;
        }

        const lists = listArray.map((list): AlexaList => {
          // Parse totalActiveItemsCount which comes as a JSON string
          let itemCount = 0;
          const totalActiveItemsCount = list.totalActiveItemsCount ||
            (list.aggregatedAttributes as Record<string, unknown>)?.totalActiveItemsCount;
          if (typeof totalActiveItemsCount === 'string') {
            try {
              const parsed = JSON.parse(totalActiveItemsCount);
              itemCount = parsed.count || 0;
            } catch {
              // Ignore parse errors
            }
          } else if (typeof totalActiveItemsCount === 'number') {
            itemCount = totalActiveItemsCount;
          }

          return {
            listId: String(list.listId || list.listInfoId || ''),
            name: String(list.listName || list.name || list.listType || ''),
            listType: String(list.listType || ''),
            defaultList: Boolean(list.defaultList),
            itemCount,
          };
        });

        this.logger.debug({ lists: lists.map(l => ({ name: l.name, type: l.listType, id: l.listId })) }, `Found ${lists.length} Alexa lists`);
        resolve(lists);
      });
    });
  }

  /**
   * Get the shopping list ID
   * Returns null if no shopping list is found
   */
  async getShoppingListId(): Promise<string | null> {
    const lists = await this.getLists();

    // Log available lists for debugging
    this.logger.debug({ lists: lists.map(l => ({ name: l.name, type: l.listType, id: l.listId })) }, 'Available Alexa lists');

    // Primary strategy: find by listType === "SHOP"
    let shoppingList = lists.find((list) => list.listType === 'SHOP');

    // Fallback: try name matching
    if (!shoppingList) {
      shoppingList = lists.find((list) => {
        const name = list.name.toLowerCase();
        return name === 'shopping' ||
               name === 'shop' ||
               name === 'alexa shopping list' ||
               name.includes('shopping') ||
               name === 'einkaufsliste' ||       // German
               name === 'liste de courses' ||    // French
               name === 'lista de compras' ||    // Spanish/Portuguese
               name === 'lista della spesa';     // Italian
      });
    }

    if (!shoppingList) {
      this.logger.warn({ availableLists: lists.map(l => ({ name: l.name, type: l.listType })) }, 'Shopping list not found. Available lists shown.');
    } else {
      this.logger.debug({ listId: shoppingList.listId, name: shoppingList.name, type: shoppingList.listType }, 'Found shopping list');
    }

    return shoppingList?.listId || null;
  }

  /**
   * Get items from a specific list
   */
  async getListItems(listId: string, includeCompleted: boolean = false): Promise<AlexaShoppingItem[]> {
    return withRetry(
      () => this.fetchListItems(listId, includeCompleted),
      this.logger,
      'getAlexaListItems'
    );
  }

  private fetchListItems(listId: string, includeCompleted: boolean): Promise<AlexaShoppingItem[]> {
    return new Promise((resolve, reject) => {
      const options: ListItemOptions = {};
      if (!includeCompleted) {
        options.completed = 'false';
      }

      this.alexa.getListItemsV2(listId, options, (err, result) => {
        if (err) {
          this.logger.error({ err, listId }, 'Failed to fetch list items');
          reject(err);
          return;
        }

        // Log raw result for debugging
        this.logger.debug({ rawResult: result }, 'Raw getListItemsV2 response');

        // getListItemsV2 returns the itemInfoList array directly (the library extracts it)
        // But we also handle the case where it returns the full response object
        let itemArray: Record<string, unknown>[];
        if (Array.isArray(result)) {
          itemArray = result as Record<string, unknown>[];
        } else {
          const typedResult = result as {
            listItems?: Record<string, unknown>[];
            itemInfoList?: Record<string, unknown>[];
          } | undefined;
          itemArray = typedResult?.itemInfoList || typedResult?.listItems || [];
        }

        if (itemArray.length === 0) {
          this.logger.debug('No items found in list');
          resolve([]);
          return;
        }

        const items = itemArray.map((item): AlexaShoppingItem => ({
          id: String(item.itemId || item.id || item.listItemId || ''),
          value: String(item.itemName || item.value || ''),
          completed: item.completed === true || item.completed === 'true' || item.itemStatus === 'COMPLETED',
          createdDateTime: item.createdDateTime || item.createAt ? String(item.createdDateTime || item.createAt) : null,
          updatedDateTime: item.updatedDateTime || item.updateAt ? String(item.updatedDateTime || item.updateAt) : null,
          version: Number(item.version || 1),
        }));

        // Filter out completed items if not including them
        const filteredItems = includeCompleted ? items : items.filter(item => !item.completed);

        this.logger.debug(`Found ${filteredItems.length} items in list ${listId}`);
        resolve(filteredItems);
      });
    });
  }

  /**
   * Get shopping list items
   */
  async getShoppingItems(includeCompleted: boolean = false): Promise<AlexaShoppingItem[]> {
    const listId = await this.getShoppingListId();
    if (!listId) {
      this.logger.warn('Shopping list not found');
      return [];
    }
    return this.getListItems(listId, includeCompleted);
  }

  /**
   * Delete an item from a list
   * @param listId The list ID
   * @param itemId The item ID to delete
   * @param version The item version (required by the API)
   */
  async deleteListItem(listId: string, itemId: string, version: number): Promise<void> {
    return withRetry(
      () => this.doDeleteListItem(listId, itemId, version),
      this.logger,
      'deleteAlexaListItem'
    );
  }

  private doDeleteListItem(listId: string, itemId: string, version: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.alexa.deleteListItem(listId, itemId, { version: String(version) }, (err) => {
        if (err) {
          this.logger.error({ err, listId, itemId, version }, 'Failed to delete list item');
          reject(err);
          return;
        }
        this.logger.debug(`Deleted list item: ${itemId} from list ${listId}`);
        resolve();
      });
    });
  }

  /**
   * Delete an item from the shopping list
   * @param itemId The item ID to delete
   * @param version The item version (required by the API)
   */
  async deleteShoppingItem(itemId: string, version: number): Promise<void> {
    const listId = await this.getShoppingListId();
    if (!listId) {
      throw new Error('Shopping list not found');
    }
    return this.deleteListItem(listId, itemId, version);
  }
}
