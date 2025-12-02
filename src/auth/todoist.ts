import { TodoistApi } from '@doist/todoist-api-typescript';
import type { Config } from '../config.js';
import type { Logger } from '../utils/logger.js';

export class TodoistAuth {
  private config: Config;
  private logger: Logger;
  private client: TodoistApi | null = null;

  constructor(config: Config, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  getClient(): TodoistApi {
    if (!this.config.todoist.api_token) {
      throw new Error(
        'Todoist API token not configured. Set it in config.yaml or via TODOIST_API_TOKEN env var.'
      );
    }

    if (!this.client) {
      this.client = new TodoistApi(this.config.todoist.api_token);
    }

    return this.client;
  }

  async validateToken(): Promise<boolean> {
    try {
      const client = this.getClient();
      // Try to fetch projects to validate token
      await client.getProjects();
      this.logger.info('Todoist authentication successful');
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Todoist token validation failed');
      return false;
    }
  }
}
