/**
 * Microsoft To-Do API Client
 * Wraps Microsoft Graph API for To-Do operations
 */

import type { Logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';
import type {
  MicrosoftTodoTask,
  MicrosoftTodoList,
  CreateMicrosoftTaskParams,
  UpdateMicrosoftTaskParams,
} from './types.js';

interface GraphResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

interface GraphUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
}

export class MicrosoftTodoClient {
  private baseUrl = 'https://graph.microsoft.com/v1.0';
  private getAccessToken: () => Promise<string>;
  private logger: Logger;

  constructor(getAccessToken: () => Promise<string>, logger: Logger) {
    this.getAccessToken = getAccessToken;
    this.logger = logger;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Microsoft Graph API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    // Handle DELETE responses (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get all task lists
   */
  async getLists(): Promise<MicrosoftTodoList[]> {
    const lists: MicrosoftTodoList[] = [];
    let nextLink: string | undefined = '/me/todo/lists';

    while (nextLink) {
      const response = await withRetry(
        () => this.request<GraphResponse<MicrosoftTodoList>>(nextLink!),
        this.logger,
        'getLists'
      );

      lists.push(...response.value);
      nextLink = response['@odata.nextLink']?.replace(this.baseUrl, '');
    }

    this.logger.debug(`Found ${lists.length} Microsoft To-Do lists`);
    return lists;
  }

  /**
   * Get a list by name
   */
  async getListByName(name: string): Promise<MicrosoftTodoList | null> {
    const lists = await this.getLists();
    const normalizedName = name.toLowerCase();
    return lists.find((list) => list.displayName.toLowerCase() === normalizedName) || null;
  }

  /**
   * Get all tasks in a list
   */
  async getTasks(listId: string, includeCompleted: boolean = false): Promise<MicrosoftTodoTask[]> {
    const tasks: MicrosoftTodoTask[] = [];
    let endpoint = `/me/todo/lists/${listId}/tasks`;

    // Filter out completed tasks if not wanted
    if (!includeCompleted) {
      endpoint += `?$filter=status ne 'completed'`;
    }

    let nextLink: string | undefined = endpoint;

    while (nextLink) {
      const response = await withRetry(
        () => this.request<GraphResponse<MicrosoftTodoTask>>(nextLink!),
        this.logger,
        'getTasks'
      );

      tasks.push(...response.value);
      nextLink = response['@odata.nextLink']?.replace(this.baseUrl, '');
    }

    this.logger.debug(`Found ${tasks.length} tasks in list ${listId}`);
    return tasks;
  }

  /**
   * Get a single task
   */
  async getTask(listId: string, taskId: string): Promise<MicrosoftTodoTask | null> {
    try {
      return await withRetry(
        () => this.request<MicrosoftTodoTask>(`/me/todo/lists/${listId}/tasks/${taskId}`),
        this.logger,
        'getTask'
      );
    } catch (error) {
      this.logger.warn({ err: error, taskId }, 'Failed to get Microsoft task');
      return null;
    }
  }

  /**
   * Create a new task
   */
  async createTask(listId: string, params: CreateMicrosoftTaskParams): Promise<MicrosoftTodoTask> {
    this.logger.debug({ listId, title: params.title }, 'Creating Microsoft task');

    return await withRetry(
      () =>
        this.request<MicrosoftTodoTask>(`/me/todo/lists/${listId}/tasks`, {
          method: 'POST',
          body: JSON.stringify(params),
        }),
      this.logger,
      'createTask'
    );
  }

  /**
   * Update an existing task
   */
  async updateTask(
    listId: string,
    taskId: string,
    params: UpdateMicrosoftTaskParams
  ): Promise<MicrosoftTodoTask> {
    this.logger.debug({ listId, taskId }, 'Updating Microsoft task');

    return await withRetry(
      () =>
        this.request<MicrosoftTodoTask>(`/me/todo/lists/${listId}/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify(params),
        }),
      this.logger,
      'updateTask'
    );
  }

  /**
   * Complete a task
   */
  async completeTask(listId: string, taskId: string): Promise<void> {
    this.logger.debug({ listId, taskId }, 'Completing Microsoft task');

    await withRetry(
      () =>
        this.request(`/me/todo/lists/${listId}/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'completed',
            completedDateTime: {
              dateTime: new Date().toISOString(),
              timeZone: 'UTC',
            },
          }),
        }),
      this.logger,
      'completeTask'
    );
  }

  /**
   * Reopen a completed task
   */
  async reopenTask(listId: string, taskId: string): Promise<void> {
    this.logger.debug({ listId, taskId }, 'Reopening Microsoft task');

    await withRetry(
      () =>
        this.request(`/me/todo/lists/${listId}/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'notStarted',
            completedDateTime: null,
          }),
        }),
      this.logger,
      'reopenTask'
    );
  }

  /**
   * Delete a task
   */
  async deleteTask(listId: string, taskId: string): Promise<void> {
    this.logger.debug({ listId, taskId }, 'Deleting Microsoft task');

    await withRetry(
      () =>
        this.request(`/me/todo/lists/${listId}/tasks/${taskId}`, {
          method: 'DELETE',
        }),
      this.logger,
      'deleteTask'
    );
  }

  /**
   * Get the current user's info
   */
  async getCurrentUser(): Promise<GraphUser> {
    return await withRetry(
      () => this.request<GraphUser>('/me'),
      this.logger,
      'getCurrentUser'
    );
  }

  /**
   * Health check - verify API access works
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.getLists();
      return true;
    } catch {
      return false;
    }
  }
}
