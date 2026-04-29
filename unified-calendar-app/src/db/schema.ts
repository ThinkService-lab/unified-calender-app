/**
 * SQLite schema definitions for the Unified Calendar App.
 * Requirements: 6.1, 6.4, 6.6, 17.1
 */

export const SCHEMA_VERSION = 1;

/**
 * All table creation SQL statements.
 * CASCADE delete constraints on events and sync_queue referencing calendar_accounts.
 */
export const CREATE_TABLES_SQL: string[] = [
  // Schema version tracking
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL
  )`,

  // Calendar accounts
  `CREATE TABLE IF NOT EXISTS calendar_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL,
    color TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public',
    sync_token TEXT,
    last_synced_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL
  )`,

  // Events (CASCADE on calendar_accounts deletion)
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    provider_event_id TEXT,
    calendar_account_id TEXT NOT NULL REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    time_zone TEXT NOT NULL,
    is_all_day INTEGER NOT NULL DEFAULT 0,
    recurrence_rule TEXT,
    recurrence_exception_date INTEGER,
    parent_recurring_event_id TEXT,
    organizer TEXT,
    attendees TEXT,
    sequence INTEGER NOT NULL DEFAULT 0,
    dtstamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    visibility_override TEXT,
    opaque_fields TEXT,
    sync_status TEXT NOT NULL DEFAULT 'synced',
    local_version INTEGER NOT NULL DEFAULT 1,
    remote_etag TEXT,
    modified_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // Sync queue (CASCADE on calendar_accounts and events deletion)
  `CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    calendar_account_id TEXT NOT NULL REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  )`,

  // User subscription
  `CREATE TABLE IF NOT EXISTS user_subscription (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free',
    platform TEXT NOT NULL,
    receipt_id TEXT,
    expires_at INTEGER,
    grace_period_ends_at INTEGER,
    auto_renew INTEGER NOT NULL DEFAULT 1,
    connected_account_count INTEGER NOT NULL DEFAULT 0
  )`,

  // Privacy preferences (CASCADE on calendar_accounts deletion)
  `CREATE TABLE IF NOT EXISTS privacy_preferences (
    calendar_id TEXT PRIMARY KEY REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    visibility TEXT NOT NULL DEFAULT 'public'
  )`,

  // Event visibility overrides (CASCADE on events deletion)
  `CREATE TABLE IF NOT EXISTS event_visibility_overrides (
    event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    visibility TEXT NOT NULL
  )`,

  // Scheduling preferences
  `CREATE TABLE IF NOT EXISTS scheduling_preferences (
    user_id TEXT PRIMARY KEY,
    preferred_start_hour INTEGER NOT NULL DEFAULT 9,
    preferred_end_hour INTEGER NOT NULL DEFAULT 17,
    minimum_buffer_minutes INTEGER NOT NULL DEFAULT 15,
    max_meetings_per_day INTEGER NOT NULL DEFAULT 8,
    focus_time_blocks TEXT,
    learned_patterns TEXT
  )`,

  // Auth events
  `CREATE TABLE IF NOT EXISTS auth_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    platform TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    timestamp INTEGER NOT NULL
  )`,

  // Onboarding state
  `CREATE TABLE IF NOT EXISTS onboarding_state (
    user_id TEXT PRIMARY KEY,
    current_step TEXT NOT NULL DEFAULT 'welcome',
    completed_steps TEXT NOT NULL DEFAULT '[]',
    skipped INTEGER NOT NULL DEFAULT 0,
    first_opened_at INTEGER NOT NULL,
    tooltips_dismissed TEXT NOT NULL DEFAULT '[]'
  )`,

  // Shared calendar views (Team tier)
  `CREATE TABLE IF NOT EXISTS shared_views (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    calendar_ids TEXT NOT NULL DEFAULT '[]',
    max_members INTEGER NOT NULL DEFAULT 20,
    created_at INTEGER NOT NULL
  )`,

  // Shared view members
  `CREATE TABLE IF NOT EXISTS shared_view_members (
    view_id TEXT NOT NULL REFERENCES shared_views(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    permission TEXT NOT NULL DEFAULT 'read-only',
    added_at INTEGER NOT NULL,
    PRIMARY KEY (view_id, user_id)
  )`,

  // Delegation grants
  `CREATE TABLE IF NOT EXISTS delegation_grants (
    id TEXT PRIMARY KEY,
    delegator_id TEXT NOT NULL,
    delegate_id TEXT NOT NULL,
    calendar_ids TEXT NOT NULL DEFAULT '[]',
    permission TEXT NOT NULL DEFAULT 'read-only',
    granted_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,

  // Deletion requests (tracks account deletion progress)
  `CREATE TABLE IF NOT EXISTS deletion_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    scheduled_completion_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  )`,
];

/**
 * All index creation SQL statements.
 */
export const CREATE_INDEXES_SQL: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_time ON events(start_time, end_time)`,
  `CREATE INDEX IF NOT EXISTS idx_events_sync ON events(sync_status)`,
  `CREATE INDEX IF NOT EXISTS idx_events_provider_id ON events(provider_event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_shared_views_owner ON shared_views(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_delegation_grants_delegate ON delegation_grants(delegate_id, revoked_at)`,
  `CREATE INDEX IF NOT EXISTS idx_delegation_grants_delegator ON delegation_grants(delegator_id, revoked_at)`,
  `CREATE INDEX IF NOT EXISTS idx_deletion_requests_user ON deletion_requests(user_id)`,
];

/**
 * Returns all SQL statements needed to initialize the database schema.
 */
export function getSchemaSQL(): string[] {
  return [...CREATE_TABLES_SQL, ...CREATE_INDEXES_SQL];
}
