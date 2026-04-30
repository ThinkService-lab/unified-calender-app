/**
 * German translations.
 * Requirements: 11.6
 */

const de: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Willkommen bei Unified Calendar',
  'onboarding.welcome.subtitle': 'Alle Ihre Kalender an einem Ort',
  'onboarding.connect.title': 'Verbinden Sie Ihr erstes Konto',
  'onboarding.connect.subtitle': 'Verknüpfen Sie Google, Outlook, iCloud oder CalDAV',
  'onboarding.view.title': 'Wählen Sie Ihre Ansicht',
  'onboarding.view.subtitle': 'Tag, Woche, Monat oder Agenda — wählen Sie Ihre Standardansicht',
  'onboarding.explore.title': 'Funktionen entdecken',
  'onboarding.explore.subtitle': 'Entdecken Sie KI-Planung, Konflikterkennung und mehr',
  'onboarding.skip': 'Überspringen',
  'onboarding.next': 'Weiter',
  'onboarding.done': 'Loslegen',

  // Common UI
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.edit': 'Bearbeiten',
  'common.close': 'Schließen',
  'common.back': 'Zurück',
  'common.confirm': 'Bestätigen',
  'common.retry': 'Erneut versuchen',
  'common.settings': 'Einstellungen',
  'common.search': 'Suchen',
  'common.loading': 'Laden…',
  'common.ok': 'OK',

  // Calendar views
  'calendar.day': 'Tag',
  'calendar.week': 'Woche',
  'calendar.month': 'Monat',
  'calendar.agenda': 'Agenda',
  'calendar.today': 'Heute',
  'calendar.noEvents': 'Keine Termine',

  // Events
  'event.create': 'Neuer Termin',
  'event.edit': 'Termin bearbeiten',
  'event.delete': 'Termin löschen',
  'event.deleteConfirm': 'Sind Sie sicher, dass Sie diesen Termin löschen möchten?',
  'event.title': 'Titel',
  'event.location': 'Ort',
  'event.description': 'Beschreibung',
  'event.startTime': 'Startzeit',
  'event.endTime': 'Endzeit',
  'event.allDay': 'Ganztägig',
  'event.recurrence': 'Wiederholung',
  'event.calendar': 'Kalender',
  'event.attendees': 'Teilnehmer',

  // Accounts
  'account.connect': 'Konto verbinden',
  'account.remove': 'Konto entfernen',
  'account.removeConfirm': 'Dieses Konto entfernen? Alle lokalen Daten werden gelöscht.',
  'account.google': 'Google Kalender',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': 'Synchronisierung…',
  'sync.lastSynced': 'Zuletzt synchronisiert: {{time}}',
  'sync.offline': 'Sie sind offline. Änderungen werden bei Wiederverbindung synchronisiert.',
  'sync.error': 'Synchronisierungsfehler. Tippen für Details.',
  'sync.conflict': 'Synchronisierungskonflikt erkannt',

  // Errors
  'error.generic': 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
  'error.network': 'Netzwerkfehler. Überprüfen Sie Ihre Verbindung.',
  'error.auth': 'Authentifizierung fehlgeschlagen. Bitte verbinden Sie Ihr Konto erneut.',
  'error.accountLimit': 'Kontolimit erreicht. Upgraden Sie auf Pro für unbegrenzte Konten.',
  'error.featureRestricted': 'Diese Funktion erfordert ein {{tier}}-Abonnement.',

  // Subscription
  'subscription.free': 'Kostenlos',
  'subscription.pro': 'Pro',
  'subscription.team': 'Team',
  'subscription.upgrade': 'Upgraden',
  'subscription.gracePeriod': 'Zahlungsproblem. {{days}} Tage verbleibend vor Herabstufung.',

  // AI Scheduling
  'ai.suggest': 'Zeiten vorschlagen',
  'ai.noSlots': 'Keine verfügbaren Zeitfenster gefunden.',
  'ai.conflict': 'Konflikt erkannt mit {{event}}',

  // Privacy
  'privacy.public': 'Öffentlich',
  'privacy.busyOnly': 'Nur Beschäftigt',
  'privacy.private': 'Privat',

  // Greeting / interpolation
  'greeting': 'Hallo, {{name}}!',
  'items.count': '{{count}} Elemente',
};

export default de;
