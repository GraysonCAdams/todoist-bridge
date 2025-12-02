import type { GoogleTask } from './client.js';
import type { CreateTaskParams, UpdateTaskParams } from '../../clients/todoist.js';
import type { Task } from '../../storage.js';
import { parseISO, format } from 'date-fns';

/**
 * Maps a Google Task to Todoist task creation parameters
 */
export function mapGoogleToTodoistCreate(
  googleTask: GoogleTask,
  projectId: string,
  parentTodoistId?: string
): CreateTaskParams {
  const params: CreateTaskParams = {
    content: googleTask.title,
    projectId,
  };

  if (googleTask.notes) {
    params.description = googleTask.notes;
  }

  if (parentTodoistId) {
    params.parentId = parentTodoistId;
  }

  if (googleTask.due) {
    // Google Tasks due date is in RFC 3339 format, but only the date part is meaningful
    params.dueDate = extractDateOnly(googleTask.due);
  }

  return params;
}

/**
 * Maps a Google Task to Todoist task update parameters
 */
export function mapGoogleToTodoistUpdate(
  googleTask: GoogleTask,
  existingTask: Task
): UpdateTaskParams | null {
  const updates: UpdateTaskParams = {};
  let hasChanges = false;

  if (googleTask.title !== existingTask.title) {
    updates.content = googleTask.title;
    hasChanges = true;
  }

  const newNotes = googleTask.notes || null;
  if (newNotes !== existingTask.notes) {
    updates.description = newNotes || '';
    hasChanges = true;
  }

  const newDueDate = googleTask.due ? extractDateOnly(googleTask.due) : null;
  if (newDueDate !== existingTask.due_date) {
    updates.dueDate = newDueDate;
    hasChanges = true;
  }

  return hasChanges ? updates : null;
}

/**
 * Check if a Google Task has been updated since the last sync
 */
export function hasGoogleTaskChanged(
  googleTask: GoogleTask,
  storedTask: Task
): boolean {
  // Compare updated timestamps
  if (googleTask.updated && storedTask.google_updated_at) {
    const googleUpdated = parseISO(googleTask.updated);
    const storedUpdated = parseISO(storedTask.google_updated_at);
    return googleUpdated > storedUpdated;
  }

  // Fall back to field comparison
  if (googleTask.title !== storedTask.title) return true;
  if ((googleTask.notes || null) !== storedTask.notes) return true;
  if (googleTask.status !== storedTask.status) return true;

  const googleDue = googleTask.due ? extractDateOnly(googleTask.due) : null;
  if (googleDue !== storedTask.due_date) return true;

  return false;
}

/**
 * Extract just the date part from an RFC 3339 datetime string
 * Google Tasks stores dates as full timestamps but only the date is meaningful
 */
function extractDateOnly(dateString: string): string {
  try {
    const date = parseISO(dateString);
    return format(date, 'yyyy-MM-dd');
  } catch {
    // If parsing fails, try to extract YYYY-MM-DD directly
    const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : dateString;
  }
}

/**
 * Determine if a task's due date is within a given number of minutes from now
 */
export function isDueSoon(dueDate: string | null | undefined, minutesThreshold: number): boolean {
  if (!dueDate) return false;

  try {
    const due = parseISO(dueDate);
    const now = new Date();
    const diffMs = due.getTime() - now.getTime();
    const diffMinutes = diffMs / (1000 * 60);

    // Task is due within threshold (positive = in future, negative = overdue)
    return diffMinutes >= 0 && diffMinutes <= minutesThreshold;
  } catch {
    return false;
  }
}
