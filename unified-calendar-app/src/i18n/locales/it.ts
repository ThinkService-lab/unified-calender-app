/**
 * Italian translations.
 * Requirements: 11.6
 */

const it: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Benvenuto su Unified Calendar',
  'onboarding.welcome.subtitle': 'Tutti i tuoi calendari in un unico posto',
  'onboarding.connect.title': 'Collega il tuo primo account',
  'onboarding.connect.subtitle': 'Collega Google, Outlook, iCloud o CalDAV',
  'onboarding.view.title': 'Scegli la tua vista',
  'onboarding.view.subtitle': 'Giorno, settimana, mese o agenda — scegli la tua vista predefinita',
  'onboarding.explore.title': 'Esplora le funzionalità',
  'onboarding.explore.subtitle': 'Scopri la pianificazione AI, il rilevamento conflitti e altro',
  'onboarding.skip': 'Salta',
  'onboarding.next': 'Avanti',
  'onboarding.done': 'Inizia',

  // Common UI
  'common.save': 'Salva',
  'common.cancel': 'Annulla',
  'common.delete': 'Elimina',
  'common.edit': 'Modifica',
  'common.close': 'Chiudi',
  'common.back': 'Indietro',
  'common.confirm': 'Conferma',
  'common.retry': 'Riprova',
  'common.settings': 'Impostazioni',
  'common.search': 'Cerca',
  'common.loading': 'Caricamento…',
  'common.ok': 'OK',

  // Calendar views
  'calendar.day': 'Giorno',
  'calendar.week': 'Settimana',
  'calendar.month': 'Mese',
  'calendar.agenda': 'Agenda',
  'calendar.today': 'Oggi',
  'calendar.noEvents': 'Nessun evento',

  // Events
  'event.create': 'Nuovo evento',
  'event.edit': 'Modifica evento',
  'event.delete': 'Elimina evento',
  'event.deleteConfirm': 'Sei sicuro di voler eliminare questo evento?',
  'event.title': 'Titolo',
  'event.location': 'Luogo',
  'event.description': 'Descrizione',
  'event.startTime': 'Ora di inizio',
  'event.endTime': 'Ora di fine',
  'event.allDay': 'Tutto il giorno',
  'event.recurrence': 'Ricorrenza',
  'event.calendar': 'Calendario',
  'event.attendees': 'Partecipanti',

  // Accounts
  'account.connect': 'Collega account',
  'account.remove': 'Rimuovi account',
  'account.removeConfirm': 'Rimuovere questo account? Tutti i dati locali verranno eliminati.',
  'account.google': 'Google Calendar',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': 'Sincronizzazione…',
  'sync.lastSynced': 'Ultima sincronizzazione: {{time}}',
  'sync.offline': 'Sei offline. Le modifiche verranno sincronizzate alla riconnessione.',
  'sync.error': 'Errore di sincronizzazione. Tocca per dettagli.',
  'sync.conflict': 'Conflitto di sincronizzazione rilevato',

  // Errors
  'error.generic': 'Qualcosa è andato storto. Per favore riprova.',
  'error.network': 'Errore di rete. Controlla la tua connessione.',
  'error.auth': 'Autenticazione fallita. Per favore ricollega il tuo account.',
  'error.accountLimit': 'Limite account raggiunto. Passa a Pro per account illimitati.',
  'error.featureRestricted': 'Questa funzione richiede un abbonamento {{tier}}.',

  // Subscription
  'subscription.free': 'Gratuito',
  'subscription.pro': 'Pro',
  'subscription.team': 'Team',
  'subscription.upgrade': 'Aggiorna',
  'subscription.gracePeriod': 'Problema di pagamento. {{days}} giorni rimanenti prima del downgrade.',

  // AI Scheduling
  'ai.suggest': 'Suggerisci orari',
  'ai.noSlots': 'Nessuna fascia oraria disponibile trovata.',
  'ai.conflict': 'Conflitto rilevato con {{event}}',

  // Privacy
  'privacy.public': 'Pubblico',
  'privacy.busyOnly': 'Solo Occupato',
  'privacy.private': 'Privato',

  // Greeting / interpolation
  'greeting': 'Ciao, {{name}}!',
  'items.count': '{{count}} elementi',
};

export default it;
