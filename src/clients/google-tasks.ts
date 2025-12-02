import { google, tasks_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Config } from '../config.js';
import type { Logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export interface GoogleTaskList {
  id: string;
  title: string;
  updated?: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  updated?: string;
  parent?: string;
  position?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export class GoogleTasksClient {
  private tasksApi: tasks_v1.Tasks;
  private config: Config;
  private logger: Logger;

  constructor(authClient: OAuth2Client, config: Config, logger: Logger) {
    this.tasksApi = google.tasks({ version: 'v1', auth: authClient });
    this.config = config;
    this.logger = logger;
  }

  async getTaskLists(): Promise<GoogleTaskList[]> {
    const taskLists: GoogleTaskList[] = [];
    let pageToken: string | undefined;

    do {
      const response = await withRetry(
        () => this.tasksApi.tasklists.list({
          maxResults: 100,
          pageToken,
        }),
        this.logger,
        'getTaskLists'
      );

      const items = response.data.items || [];
      for (const item of items) {
        if (item.id && item.title) {
          taskLists.push({
            id: item.id,
            title: item.title,
            updated: item.updated || undefined,
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    this.logger.debug(`Found ${taskLists.length} task lists`);
    return taskLists;
  }

  async getTasks(taskListId: string, includeCompleted: boolean = false): Promise<GoogleTask[]> {
    const tasks: GoogleTask[] = [];
    let pageToken: string | undefined;

    do {
      const response = await withRetry(
        () => this.tasksApi.tasks.list({
          tasklist: taskListId,
          maxResults: 100,
          showCompleted: includeCompleted,
          showHidden: false,
          showDeleted: false,
          pageToken,
        }),
        this.logger,
        'getTasks'
      );

      const items = response.data.items || [];
      for (const item of items) {
        if (item.id && item.title) {
          tasks.push({
            id: item.id,
            title: item.title,
            notes: item.notes || undefined,
            status: item.status as 'needsAction' | 'completed',
            due: item.due || undefined,
            updated: item.updated || undefined,
            parent: item.parent || undefined,
            position: item.position || undefined,
            completed: item.completed || undefined,
            deleted: item.deleted || false,
            hidden: item.hidden || false,
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    this.logger.debug(`Found ${tasks.length} tasks in list ${taskListId}`);
    return tasks;
  }

  async getTask(taskListId: string, taskId: string): Promise<GoogleTask | null> {
    try {
      const response = await withRetry(
        () => this.tasksApi.tasks.get({
          tasklist: taskListId,
          task: taskId,
        }),
        this.logger,
        'getTask'
      );

      const item = response.data;
      if (!item.id || !item.title) return null;

      return {
        id: item.id,
        title: item.title,
        notes: item.notes || undefined,
        status: item.status as 'needsAction' | 'completed',
        due: item.due || undefined,
        updated: item.updated || undefined,
        parent: item.parent || undefined,
        position: item.position || undefined,
        completed: item.completed || undefined,
        deleted: item.deleted || false,
        hidden: item.hidden || false,
      };
    } catch (error) {
      this.logger.warn({ err: error }, `Failed to get task ${taskId}`);
      return null;
    }
  }

  async deleteTask(taskListId: string, taskId: string): Promise<void> {
    this.logger.debug(`Deleting Google task: ${taskId} from list ${taskListId}`);
    await withRetry(
      () => this.tasksApi.tasks.delete({
        tasklist: taskListId,
        task: taskId,
      }),
      this.logger,
      'deleteTask'
    );
  }
}
