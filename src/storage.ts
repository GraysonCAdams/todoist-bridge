import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export interface TaskList {
  id: string;
  google_id: string;
  todoist_id: string | null;
  name: string;
  created_at: string;
}

export interface Task {
  id: string;
  google_id: string;
  todoist_id: string | null;
  task_list_id: string;
  title: string;
  notes: string | null;
  status: 'needsAction' | 'completed';
  due_date: string | null;
  parent_google_id: string | null;
  parent_todoist_id: string | null;
  google_updated_at: string | null;
  synced_at: string | null;
  applied_tags: string | null; // JSON array of applied tags
}

export interface SyncState {
  id: string;
  last_sync_at: string | null;
  completed_tasks_imported: number;
}

export interface AlexaReminder {
  id: string;
  alexa_id: string;
  todoist_id: string | null;
  title: string;
  reminder_time: string | null;
  status: string; // 'ON', 'OFF'
  device_name: string | null;
  synced_at: string | null;
  alexa_updated_at: string | null;
  applied_tags: string | null; // JSON array of applied tags
}

export interface AlexaShoppingItemRecord {
  id: string;
  alexa_id: string;
  alexa_list_id: string;
  todoist_id: string | null;
  value: string;
  completed: number; // SQLite boolean: 0 or 1
  synced_at: string | null;
  alexa_updated_at: string | null;
  applied_tags: string | null; // JSON array of applied tags
}

export class Storage {
  private db: Database.Database;

  constructor(databasePath: string) {
    // Ensure directory exists
    const dir = dirname(databasePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      -- Maps Google Task Lists to Todoist Projects
      CREATE TABLE IF NOT EXISTS task_lists (
        id TEXT PRIMARY KEY,
        google_id TEXT UNIQUE NOT NULL,
        todoist_id TEXT UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Tracks synced tasks (cache to detect changes/deletions)
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        google_id TEXT UNIQUE NOT NULL,
        todoist_id TEXT,
        task_list_id TEXT NOT NULL,
        title TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL,
        due_date TEXT,
        parent_google_id TEXT,
        parent_todoist_id TEXT,
        google_updated_at TEXT,
        synced_at TEXT,
        applied_tags TEXT,
        FOREIGN KEY (task_list_id) REFERENCES task_lists(id)
      );

      -- Migration: add applied_tags column if it doesn't exist
      -- SQLite doesn't have ADD COLUMN IF NOT EXISTS, so we check via pragma


      -- Sync state
      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY DEFAULT 'main',
        last_sync_at TEXT,
        completed_tasks_imported INTEGER DEFAULT 0
      );

      -- Initialize sync state if not exists
      INSERT OR IGNORE INTO sync_state (id) VALUES ('main');

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_tasks_google_id ON tasks(google_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_todoist_id ON tasks(todoist_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_task_list_id ON tasks(task_list_id);
      CREATE INDEX IF NOT EXISTS idx_task_lists_google_id ON task_lists(google_id);

      -- Alexa reminders tracking
      CREATE TABLE IF NOT EXISTS alexa_reminders (
        id TEXT PRIMARY KEY,
        alexa_id TEXT UNIQUE NOT NULL,
        todoist_id TEXT,
        title TEXT NOT NULL,
        reminder_time TEXT,
        status TEXT NOT NULL,
        device_name TEXT,
        synced_at TEXT,
        alexa_updated_at TEXT,
        applied_tags TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_alexa_reminders_alexa_id ON alexa_reminders(alexa_id);
      CREATE INDEX IF NOT EXISTS idx_alexa_reminders_todoist_id ON alexa_reminders(todoist_id);

      -- Alexa shopping list items tracking
      CREATE TABLE IF NOT EXISTS alexa_shopping_items (
        id TEXT PRIMARY KEY,
        alexa_id TEXT UNIQUE NOT NULL,
        alexa_list_id TEXT NOT NULL,
        todoist_id TEXT,
        value TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT,
        alexa_updated_at TEXT,
        applied_tags TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_alexa_shopping_items_alexa_id ON alexa_shopping_items(alexa_id);
      CREATE INDEX IF NOT EXISTS idx_alexa_shopping_items_todoist_id ON alexa_shopping_items(todoist_id);
    `);

    // Run migrations for existing databases
    this.runMigrations();
  }

  private runMigrations(): void {
    // Check if applied_tags column exists in tasks table
    const tasksColumns = this.db.pragma('table_info(tasks)') as { name: string }[];
    if (!tasksColumns.some(col => col.name === 'applied_tags')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN applied_tags TEXT');
    }

    // Check if applied_tags column exists in alexa_reminders table
    const alexaColumns = this.db.pragma('table_info(alexa_reminders)') as { name: string }[];
    if (!alexaColumns.some(col => col.name === 'applied_tags')) {
      this.db.exec('ALTER TABLE alexa_reminders ADD COLUMN applied_tags TEXT');
    }
  }

  // Task List operations
  getTaskListByGoogleId(googleId: string): TaskList | null {
    const stmt = this.db.prepare('SELECT * FROM task_lists WHERE google_id = ?');
    return stmt.get(googleId) as TaskList | undefined || null;
  }

  getTaskListByTodoistId(todoistId: string): TaskList | null {
    const stmt = this.db.prepare('SELECT * FROM task_lists WHERE todoist_id = ?');
    return stmt.get(todoistId) as TaskList | undefined || null;
  }

  getAllTaskLists(): TaskList[] {
    const stmt = this.db.prepare('SELECT * FROM task_lists');
    return stmt.all() as TaskList[];
  }

  createTaskList(googleId: string, name: string, todoistId: string | null = null): TaskList {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO task_lists (id, google_id, todoist_id, name)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, googleId, todoistId, name);
    return this.getTaskListByGoogleId(googleId)!;
  }

  updateTaskListTodoistId(googleId: string, todoistId: string): void {
    const stmt = this.db.prepare('UPDATE task_lists SET todoist_id = ? WHERE google_id = ?');
    stmt.run(todoistId, googleId);
  }

  // Task operations
  getTaskByGoogleId(googleId: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE google_id = ?');
    return stmt.get(googleId) as Task | undefined || null;
  }

  getTaskByTodoistId(todoistId: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE todoist_id = ?');
    return stmt.get(todoistId) as Task | undefined || null;
  }

  getTasksByTaskListId(taskListId: string): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE task_list_id = ?');
    return stmt.all(taskListId) as Task[];
  }

  getTasksByGoogleListId(googleListId: string): Task[] {
    const stmt = this.db.prepare(`
      SELECT t.* FROM tasks t
      JOIN task_lists tl ON t.task_list_id = tl.id
      WHERE tl.google_id = ?
    `);
    return stmt.all(googleListId) as Task[];
  }

  /**
   * Get all tasks that have a Todoist ID (for cache validation)
   */
  getAllTasksWithTodoistId(): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE todoist_id IS NOT NULL');
    return stmt.all() as Task[];
  }

  /**
   * Remove tasks from cache that no longer exist in Todoist
   * Returns the number of stale tasks removed
   */
  cleanupStaleTasks(validTodoistIds: Set<string>): number {
    const tasks = this.getAllTasksWithTodoistId();
    let removed = 0;

    for (const task of tasks) {
      if (task.todoist_id && !validTodoistIds.has(task.todoist_id)) {
        this.deleteTask(task.google_id);
        removed++;
      }
    }

    return removed;
  }

  createTask(task: Omit<Task, 'id' | 'synced_at'>): Task {
    const id = randomUUID();
    const synced_at = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, google_id, todoist_id, task_list_id, title, notes,
        status, due_date, parent_google_id, parent_todoist_id,
        google_updated_at, synced_at, applied_tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      task.google_id,
      task.todoist_id,
      task.task_list_id,
      task.title,
      task.notes,
      task.status,
      task.due_date,
      task.parent_google_id,
      task.parent_todoist_id,
      task.google_updated_at,
      synced_at,
      task.applied_tags
    );

    return this.getTaskByGoogleId(task.google_id)!;
  }

  updateTask(googleId: string, updates: Partial<Omit<Task, 'id' | 'google_id'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.todoist_id !== undefined) {
      fields.push('todoist_id = ?');
      values.push(updates.todoist_id);
    }
    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.due_date !== undefined) {
      fields.push('due_date = ?');
      values.push(updates.due_date);
    }
    if (updates.parent_google_id !== undefined) {
      fields.push('parent_google_id = ?');
      values.push(updates.parent_google_id);
    }
    if (updates.parent_todoist_id !== undefined) {
      fields.push('parent_todoist_id = ?');
      values.push(updates.parent_todoist_id);
    }
    if (updates.google_updated_at !== undefined) {
      fields.push('google_updated_at = ?');
      values.push(updates.google_updated_at);
    }
    if (updates.applied_tags !== undefined) {
      fields.push('applied_tags = ?');
      values.push(updates.applied_tags);
    }

    fields.push('synced_at = ?');
    values.push(new Date().toISOString());

    values.push(googleId);

    const stmt = this.db.prepare(
      `UPDATE tasks SET ${fields.join(', ')} WHERE google_id = ?`
    );
    stmt.run(...values);
  }

  deleteTask(googleId: string): void {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE google_id = ?');
    stmt.run(googleId);
  }

  deleteTaskByTodoistId(todoistId: string): void {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE todoist_id = ?');
    stmt.run(todoistId);
  }

  // Sync state operations
  getSyncState(): SyncState {
    const stmt = this.db.prepare('SELECT * FROM sync_state WHERE id = ?');
    return stmt.get('main') as SyncState;
  }

  updateSyncState(updates: Partial<Omit<SyncState, 'id'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.last_sync_at !== undefined) {
      fields.push('last_sync_at = ?');
      values.push(updates.last_sync_at);
    }
    if (updates.completed_tasks_imported !== undefined) {
      fields.push('completed_tasks_imported = ?');
      values.push(updates.completed_tasks_imported);
    }

    if (fields.length === 0) return;

    values.push('main');

    const stmt = this.db.prepare(
      `UPDATE sync_state SET ${fields.join(', ')} WHERE id = ?`
    );
    stmt.run(...values);
  }

  markCompletedTasksImported(): void {
    this.updateSyncState({ completed_tasks_imported: 1 });
  }

  hasImportedCompletedTasks(): boolean {
    const state = this.getSyncState();
    return state.completed_tasks_imported === 1;
  }

  // Alexa Reminder operations
  getAlexaReminderByAlexaId(alexaId: string): AlexaReminder | null {
    const stmt = this.db.prepare('SELECT * FROM alexa_reminders WHERE alexa_id = ?');
    return stmt.get(alexaId) as AlexaReminder | undefined || null;
  }

  getAlexaReminderByTodoistId(todoistId: string): AlexaReminder | null {
    const stmt = this.db.prepare('SELECT * FROM alexa_reminders WHERE todoist_id = ?');
    return stmt.get(todoistId) as AlexaReminder | undefined || null;
  }

  getAllAlexaReminders(): AlexaReminder[] {
    const stmt = this.db.prepare('SELECT * FROM alexa_reminders');
    return stmt.all() as AlexaReminder[];
  }

  createAlexaReminder(reminder: Omit<AlexaReminder, 'id' | 'synced_at'>): AlexaReminder {
    const id = randomUUID();
    const synced_at = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO alexa_reminders (
        id, alexa_id, todoist_id, title, reminder_time,
        status, device_name, synced_at, alexa_updated_at, applied_tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      reminder.alexa_id,
      reminder.todoist_id,
      reminder.title,
      reminder.reminder_time,
      reminder.status,
      reminder.device_name,
      synced_at,
      reminder.alexa_updated_at,
      reminder.applied_tags
    );

    return this.getAlexaReminderByAlexaId(reminder.alexa_id)!;
  }

  updateAlexaReminder(alexaId: string, updates: Partial<Omit<AlexaReminder, 'id' | 'alexa_id'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.todoist_id !== undefined) {
      fields.push('todoist_id = ?');
      values.push(updates.todoist_id);
    }
    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.reminder_time !== undefined) {
      fields.push('reminder_time = ?');
      values.push(updates.reminder_time);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.device_name !== undefined) {
      fields.push('device_name = ?');
      values.push(updates.device_name);
    }
    if (updates.alexa_updated_at !== undefined) {
      fields.push('alexa_updated_at = ?');
      values.push(updates.alexa_updated_at);
    }
    if (updates.applied_tags !== undefined) {
      fields.push('applied_tags = ?');
      values.push(updates.applied_tags);
    }

    fields.push('synced_at = ?');
    values.push(new Date().toISOString());

    if (fields.length === 1) return; // Only synced_at, no actual updates

    values.push(alexaId);

    const stmt = this.db.prepare(
      `UPDATE alexa_reminders SET ${fields.join(', ')} WHERE alexa_id = ?`
    );
    stmt.run(...values);
  }

  deleteAlexaReminder(alexaId: string): void {
    const stmt = this.db.prepare('DELETE FROM alexa_reminders WHERE alexa_id = ?');
    stmt.run(alexaId);
  }

  deleteAlexaReminderByTodoistId(todoistId: string): void {
    const stmt = this.db.prepare('DELETE FROM alexa_reminders WHERE todoist_id = ?');
    stmt.run(todoistId);
  }

  /**
   * Get all Alexa reminders that have a Todoist ID (for cache validation)
   */
  getAllAlexaRemindersWithTodoistId(): AlexaReminder[] {
    const stmt = this.db.prepare('SELECT * FROM alexa_reminders WHERE todoist_id IS NOT NULL');
    return stmt.all() as AlexaReminder[];
  }

  /**
   * Remove Alexa reminders from cache that no longer exist in Todoist
   * Returns the number of stale reminders removed
   */
  cleanupStaleAlexaReminders(validTodoistIds: Set<string>): number {
    const reminders = this.getAllAlexaRemindersWithTodoistId();
    let removed = 0;

    for (const reminder of reminders) {
      if (reminder.todoist_id && !validTodoistIds.has(reminder.todoist_id)) {
        this.deleteAlexaReminder(reminder.alexa_id);
        removed++;
      }
    }

    return removed;
  }

  // Alexa Shopping Item operations
  getAlexaShoppingItemByAlexaId(alexaId: string): AlexaShoppingItemRecord | null {
    const stmt = this.db.prepare('SELECT * FROM alexa_shopping_items WHERE alexa_id = ?');
    return stmt.get(alexaId) as AlexaShoppingItemRecord | undefined || null;
  }

  getAlexaShoppingItemByTodoistId(todoistId: string): AlexaShoppingItemRecord | null {
    const stmt = this.db.prepare('SELECT * FROM alexa_shopping_items WHERE todoist_id = ?');
    return stmt.get(todoistId) as AlexaShoppingItemRecord | undefined || null;
  }

  getAllAlexaShoppingItems(): AlexaShoppingItemRecord[] {
    const stmt = this.db.prepare('SELECT * FROM alexa_shopping_items');
    return stmt.all() as AlexaShoppingItemRecord[];
  }

  createAlexaShoppingItem(item: Omit<AlexaShoppingItemRecord, 'id' | 'synced_at'>): AlexaShoppingItemRecord {
    const id = randomUUID();
    const synced_at = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO alexa_shopping_items (
        id, alexa_id, alexa_list_id, todoist_id, value,
        completed, synced_at, alexa_updated_at, applied_tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      item.alexa_id,
      item.alexa_list_id,
      item.todoist_id,
      item.value,
      item.completed,
      synced_at,
      item.alexa_updated_at,
      item.applied_tags
    );

    return this.getAlexaShoppingItemByAlexaId(item.alexa_id)!;
  }

  updateAlexaShoppingItem(alexaId: string, updates: Partial<Omit<AlexaShoppingItemRecord, 'id' | 'alexa_id'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.todoist_id !== undefined) {
      fields.push('todoist_id = ?');
      values.push(updates.todoist_id);
    }
    if (updates.alexa_list_id !== undefined) {
      fields.push('alexa_list_id = ?');
      values.push(updates.alexa_list_id);
    }
    if (updates.value !== undefined) {
      fields.push('value = ?');
      values.push(updates.value);
    }
    if (updates.completed !== undefined) {
      fields.push('completed = ?');
      values.push(updates.completed);
    }
    if (updates.alexa_updated_at !== undefined) {
      fields.push('alexa_updated_at = ?');
      values.push(updates.alexa_updated_at);
    }
    if (updates.applied_tags !== undefined) {
      fields.push('applied_tags = ?');
      values.push(updates.applied_tags);
    }

    fields.push('synced_at = ?');
    values.push(new Date().toISOString());

    if (fields.length === 1) return; // Only synced_at, no actual updates

    values.push(alexaId);

    const stmt = this.db.prepare(
      `UPDATE alexa_shopping_items SET ${fields.join(', ')} WHERE alexa_id = ?`
    );
    stmt.run(...values);
  }

  deleteAlexaShoppingItem(alexaId: string): void {
    const stmt = this.db.prepare('DELETE FROM alexa_shopping_items WHERE alexa_id = ?');
    stmt.run(alexaId);
  }

  deleteAlexaShoppingItemByTodoistId(todoistId: string): void {
    const stmt = this.db.prepare('DELETE FROM alexa_shopping_items WHERE todoist_id = ?');
    stmt.run(todoistId);
  }

  /**
   * Get all Alexa shopping items that have a Todoist ID (for cache validation)
   */
  getAllAlexaShoppingItemsWithTodoistId(): AlexaShoppingItemRecord[] {
    const stmt = this.db.prepare('SELECT * FROM alexa_shopping_items WHERE todoist_id IS NOT NULL');
    return stmt.all() as AlexaShoppingItemRecord[];
  }

  /**
   * Remove Alexa shopping items from cache that no longer exist in Todoist
   * Returns the number of stale items removed
   */
  cleanupStaleAlexaShoppingItems(validTodoistIds: Set<string>): number {
    const items = this.getAllAlexaShoppingItemsWithTodoistId();
    let removed = 0;

    for (const item of items) {
      if (item.todoist_id && !validTodoistIds.has(item.todoist_id)) {
        this.deleteAlexaShoppingItem(item.alexa_id);
        removed++;
      }
    }

    return removed;
  }

  close(): void {
    this.db.close();
  }
}
