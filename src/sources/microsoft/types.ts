/**
 * Microsoft To-Do Source Configuration Types
 */

import { z } from 'zod';

/**
 * Microsoft To-Do list mapping configuration
 */
export const MicrosoftListMappingSchema = z.object({
  /** Microsoft To-Do List ID (optional if list_name is provided) */
  source_list_id: z.string().optional(),
  /** Microsoft To-Do List name (used to find list if source_list_id not provided) */
  list_name: z.string().optional(),
  /** Target Todoist project ID or "inbox" */
  todoist_project_id: z.string(),
  /** Include completed tasks in sync */
  include_completed: z.boolean().default(false),
  /** Tags to apply to synced tasks in Todoist */
  tags: z.array(z.string()).default([]),
});

export type MicrosoftListMapping = z.infer<typeof MicrosoftListMappingSchema>;

/**
 * Microsoft To-Do source configuration
 */
export const MicrosoftSourceConfigSchema = z.object({
  /** Enable/disable this source */
  enabled: z.boolean().default(false),

  /**
   * Azure AD Application (client) ID
   * Get from Azure Portal > App registrations > Your app > Overview
   */
  client_id: z.string().default(''),

  /**
   * Azure AD Directory (tenant) ID
   * - 'common': Multi-tenant + personal accounts (default)
   * - 'consumers': Personal Microsoft accounts only
   * - Specific tenant ID: Organization-only access
   */
  tenant_id: z.string().default('common'),

  /** Path to store OAuth tokens */
  token_path: z.string().default('./credentials/microsoft-token.json'),

  /** Polling interval in minutes (1-60) */
  poll_interval_minutes: z.number().min(1).max(60).default(5),

  /** List mappings - each Microsoft To-Do list to sync */
  lists: z.array(MicrosoftListMappingSchema).default([]),

  /**
   * Assign items synced from Todoist to yourself
   * Useful for shared lists where you want items assigned to you
   */
  assign_to_self: z.boolean().default(false),

  /**
   * Only sync items you created or unassigned
   * When true, items from other users in shared lists are excluded from sync
   */
  exclude_others_assignments: z.boolean().default(true),
});

export type MicrosoftSourceConfig = z.infer<typeof MicrosoftSourceConfigSchema>;

/**
 * Microsoft To-Do task as returned by Microsoft Graph API
 */
export interface MicrosoftTodoTask {
  id: string;
  title: string;
  body?: {
    content: string;
    contentType: 'text' | 'html';
  };
  status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred';
  importance: 'low' | 'normal' | 'high';
  isReminderOn: boolean;
  createdDateTime: string;
  lastModifiedDateTime: string;
  completedDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  dueDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  reminderDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  // Assignment info for shared lists
  linkedResources?: Array<{
    id: string;
    webUrl?: string;
    applicationName?: string;
    displayName?: string;
    externalId?: string;
  }>;
  // Created by info (available in shared lists)
  createdBy?: {
    user?: {
      id: string;
      displayName?: string;
    };
  };
}

/**
 * Microsoft To-Do list as returned by Microsoft Graph API
 */
export interface MicrosoftTodoList {
  id: string;
  displayName: string;
  isOwner: boolean;
  isShared: boolean;
  wellknownListName?: 'none' | 'defaultList' | 'flaggedEmails' | 'unknownFutureValue';
}

/**
 * Parameters for creating a task in Microsoft To-Do
 */
export interface CreateMicrosoftTaskParams {
  title: string;
  body?: {
    content: string;
    contentType: 'text' | 'html';
  };
  importance?: 'low' | 'normal' | 'high';
  dueDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  reminderDateTime?: {
    dateTime: string;
    timeZone: string;
  };
  isReminderOn?: boolean;
}

/**
 * Parameters for updating a task in Microsoft To-Do
 */
export interface UpdateMicrosoftTaskParams {
  title?: string;
  body?: {
    content: string;
    contentType: 'text' | 'html';
  };
  status?: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred';
  importance?: 'low' | 'normal' | 'high';
  dueDateTime?: {
    dateTime: string;
    timeZone: string;
  } | null;
  reminderDateTime?: {
    dateTime: string;
    timeZone: string;
  } | null;
  isReminderOn?: boolean;
}
