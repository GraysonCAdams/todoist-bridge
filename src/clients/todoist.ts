import { TodoistApi, Project, Task } from '@doist/todoist-api-typescript';
import type { Logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export interface CreateTaskParams {
  content: string;
  description?: string;
  projectId: string;
  parentId?: string;
  dueDate?: string;
  labels?: string[];
}

export interface UpdateTaskParams {
  content?: string;
  description?: string;
  dueDate?: string | null;
  labels?: string[];
}

export class TodoistClient {
  private api: TodoistApi;
  private logger: Logger;

  constructor(api: TodoistApi, logger: Logger) {
    this.api = api;
    this.logger = logger;
  }

  async getProjects(): Promise<Project[]> {
    return withRetry(
      () => this.api.getProjects(),
      this.logger,
      'getProjects'
    );
  }

  async getInboxProject(): Promise<Project | null> {
    const projects = await this.getProjects();
    // Inbox project has inboxProject property set to true
    return projects.find((p) => p.isInboxProject) || null;
  }

  /**
   * Get the inbox project ID
   * Throws if inbox cannot be found (should never happen)
   */
  async getInboxProjectId(): Promise<string> {
    const inbox = await this.getInboxProject();
    if (!inbox) {
      throw new Error('Could not find Todoist inbox project');
    }
    return inbox.id;
  }

  /**
   * Resolve a project ID, handling special values like "inbox"
   * Returns the actual project ID to use
   */
  async resolveProjectId(projectId: string): Promise<string> {
    if (projectId.toLowerCase() === 'inbox') {
      return this.getInboxProjectId();
    }
    return projectId;
  }

  async getProjectByName(name: string): Promise<Project | null> {
    const projects = await this.getProjects();
    return projects.find((p) => p.name === name) || null;
  }

  async createProject(name: string): Promise<Project> {
    this.logger.info(`Creating Todoist project: ${name}`);
    return withRetry(
      () => this.api.addProject({ name }),
      this.logger,
      'createProject'
    );
  }

  async getProjectTasks(projectId: string): Promise<Task[]> {
    return withRetry(
      () => this.api.getTasks({ projectId }),
      this.logger,
      'getProjectTasks'
    );
  }

  /**
   * Get all task IDs that exist in Todoist for a given project
   */
  async getProjectTaskIds(projectId: string): Promise<Set<string>> {
    const tasks = await this.getProjectTasks(projectId);
    return new Set(tasks.map(t => t.id));
  }

  /**
   * Get all task IDs that exist in Todoist across multiple projects
   */
  async getTaskIdsForProjects(projectIds: string[]): Promise<Set<string>> {
    const allIds = new Set<string>();
    for (const projectId of projectIds) {
      try {
        const tasks = await this.getProjectTasks(projectId);
        tasks.forEach(t => allIds.add(t.id));
      } catch (error) {
        this.logger.warn({ err: error }, `Failed to fetch tasks for project ${projectId}`);
      }
    }
    return allIds;
  }

  async createTask(params: CreateTaskParams): Promise<Task> {
    this.logger.debug(`Creating Todoist task: ${params.content}`);

    const taskParams: {
      content: string;
      projectId: string;
      description?: string;
      parentId?: string;
      dueString?: string;
      labels?: string[];
    } = {
      content: params.content,
      projectId: params.projectId,
    };

    if (params.description) {
      taskParams.description = params.description;
    }

    if (params.parentId) {
      taskParams.parentId = params.parentId;
    }

    if (params.dueDate) {
      // Use dueString which accepts date format like "2024-01-15"
      taskParams.dueString = params.dueDate;
    }

    if (params.labels && params.labels.length > 0) {
      taskParams.labels = params.labels;
    }

    return withRetry(
      () => this.api.addTask(taskParams),
      this.logger,
      'createTask'
    );
  }

  async updateTask(taskId: string, params: UpdateTaskParams): Promise<Task> {
    this.logger.debug(`Updating Todoist task: ${taskId}`);

    const updateParams: {
      content?: string;
      description?: string;
      dueString?: string;
      labels?: string[];
    } = {};

    if (params.content !== undefined) {
      updateParams.content = params.content;
    }

    if (params.description !== undefined) {
      updateParams.description = params.description;
    }

    if (params.dueDate !== undefined && params.dueDate !== null) {
      // Use dueString which accepts date format like "2024-01-15"
      updateParams.dueString = params.dueDate;
    }

    if (params.labels !== undefined) {
      updateParams.labels = params.labels;
    }

    return withRetry(
      () => this.api.updateTask(taskId, updateParams),
      this.logger,
      'updateTask'
    );
  }

  async completeTask(taskId: string): Promise<void> {
    this.logger.debug(`Completing Todoist task: ${taskId}`);
    await withRetry(
      () => this.api.closeTask(taskId),
      this.logger,
      'completeTask'
    );
  }

  async reopenTask(taskId: string): Promise<void> {
    this.logger.debug(`Reopening Todoist task: ${taskId}`);
    await withRetry(
      () => this.api.reopenTask(taskId),
      this.logger,
      'reopenTask'
    );
  }

  async deleteTask(taskId: string): Promise<void> {
    this.logger.debug(`Deleting Todoist task: ${taskId}`);
    await withRetry(
      () => this.api.deleteTask(taskId),
      this.logger,
      'deleteTask'
    );
  }
}
