/**
 * English translations (default locale).
 * Requirements: 11.6
 */

const en: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Welcome to Unified Calendar',
  'onboarding.welcome.subtitle': 'All your calendars in one place',
  'onboarding.connect.title': 'Connect Your First Account',
  'onboarding.connect.subtitle': 'Link Google, Outlook, iCloud, or CalDAV',
  'onboarding.view.title': 'Choose Your View',
  'onboarding.view.subtitle': 'Day, week, month, or agenda — pick your default',
  'onboarding.explore.title': 'Explore Features',
  'onboarding.explore.subtitle': 'Discover AI scheduling, conflict detection, and more',
  'onboarding.skip': 'Skip',
  'onboarding.next': 'Next',
  'onboarding.done': 'Get Started',

  // Common UI
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.confirm': 'Confirm',
  'common.retry': 'Retry',
  'common.settings': 'Settings',
  'common.search': 'Search',
  'common.loading': 'Loading…',
  'common.ok': 'OK',

  // Calendar views
  'calendar.day': 'Day',
  'calendar.week': 'Week',
  'calendar.month': 'Month',
  'calendar.agenda': 'Agenda',
  'calendar.today': 'Today',
  'calendar.noEvents': 'No events',

  // Events
  'event.create': 'New Event',
  'event.edit': 'Edit Event',
  'event.delete': 'Delete Event',
  'event.deleteConfirm': 'Are you sure you want to delete this event?',
  'event.title': 'Title',
  'event.location': 'Location',
  'event.description': 'Description',
  'event.startTime': 'Start Time',
  'event.endTime': 'End Time',
  'event.allDay': 'All Day',
  'event.recurrence': 'Recurrence',
  'event.calendar': 'Calendar',
  'event.attendees': 'Attendees',

  // Accounts
  'account.connect': 'Connect Account',
  'account.remove': 'Remove Account',
  'account.removeConfirm': 'Remove this account? All local data will be deleted.',
  'account.google': 'Google Calendar',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': 'Syncing…',
  'sync.lastSynced': 'Last synced: {{time}}',
  'sync.offline': 'You are offline. Changes will sync when reconnected.',
  'sync.error': 'Sync error. Tap for details.',
  'sync.conflict': 'Sync conflict detected',

  // Errors
  'error.generic': 'Something went wrong. Please try again.',
  'error.network': 'Network error. Check your connection.',
  'error.auth': 'Authentication failed. Please reconnect your account.',
  'error.accountLimit': 'Account limit reached. Upgrade to Pro for unlimited accounts.',
  'error.featureRestricted': 'This feature requires a {{tier}} subscription.',

  // Subscription
  'subscription.free': 'Free',
  'subscription.pro': 'Pro',
  'subscription.team': 'Team',
  'subscription.upgrade': 'Upgrade',
  'subscription.gracePeriod': 'Payment issue. {{days}} days remaining before downgrade.',

  // AI Scheduling
  'ai.suggest': 'Suggest Times',
  'ai.noSlots': 'No available time slots found.',
  'ai.conflict': 'Conflict detected with {{event}}',

  // Privacy
  'privacy.public': 'Public',
  'privacy.busyOnly': 'Busy Only',
  'privacy.private': 'Private',

  // Greeting (for interpolation testing)
  'greeting': 'Hello, {{name}}!',
  'items.count': '{{count}} items',
  'items.count_zero': 'No items',
  'items.count_one': '{{count}} item',
  'items.count_other': '{{count}} items',
};

export default en;
