/**
 * French translations.
 * Requirements: 11.6
 */

const fr: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Bienvenue sur Unified Calendar',
  'onboarding.welcome.subtitle': 'Tous vos calendriers en un seul endroit',
  'onboarding.connect.title': 'Connectez votre premier compte',
  'onboarding.connect.subtitle': 'Liez Google, Outlook, iCloud ou CalDAV',
  'onboarding.view.title': 'Choisissez votre vue',
  'onboarding.view.subtitle': 'Jour, semaine, mois ou agenda — choisissez votre vue par défaut',
  'onboarding.explore.title': 'Explorez les fonctionnalités',
  'onboarding.explore.subtitle': 'Découvrez la planification IA, la détection de conflits et plus',
  'onboarding.skip': 'Passer',
  'onboarding.next': 'Suivant',
  'onboarding.done': 'Commencer',

  // Common UI
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
  'common.close': 'Fermer',
  'common.back': 'Retour',
  'common.confirm': 'Confirmer',
  'common.retry': 'Réessayer',
  'common.settings': 'Paramètres',
  'common.search': 'Rechercher',
  'common.loading': 'Chargement…',
  'common.ok': 'OK',

  // Calendar views
  'calendar.day': 'Jour',
  'calendar.week': 'Semaine',
  'calendar.month': 'Mois',
  'calendar.agenda': 'Agenda',
  'calendar.today': "Aujourd'hui",
  'calendar.noEvents': 'Aucun événement',

  // Events
  'event.create': 'Nouvel événement',
  'event.edit': 'Modifier événement',
  'event.delete': 'Supprimer événement',
  'event.deleteConfirm': 'Êtes-vous sûr de vouloir supprimer cet événement ?',
  'event.title': 'Titre',
  'event.location': 'Lieu',
  'event.description': 'Description',
  'event.startTime': 'Heure de début',
  'event.endTime': 'Heure de fin',
  'event.allDay': 'Toute la journée',
  'event.recurrence': 'Récurrence',
  'event.calendar': 'Calendrier',
  'event.attendees': 'Participants',

  // Accounts
  'account.connect': 'Connecter un compte',
  'account.remove': 'Supprimer le compte',
  'account.removeConfirm': 'Supprimer ce compte ? Toutes les données locales seront effacées.',
  'account.google': 'Google Agenda',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': 'Synchronisation…',
  'sync.lastSynced': 'Dernière synchronisation : {{time}}',
  'sync.offline': 'Vous êtes hors ligne. Les modifications seront synchronisées à la reconnexion.',
  'sync.error': 'Erreur de synchronisation. Appuyez pour plus de détails.',
  'sync.conflict': 'Conflit de synchronisation détecté',

  // Errors
  'error.generic': "Quelque chose s'est mal passé. Veuillez réessayer.",
  'error.network': 'Erreur réseau. Vérifiez votre connexion.',
  'error.auth': 'Authentification échouée. Veuillez reconnecter votre compte.',
  'error.accountLimit': 'Limite de comptes atteinte. Passez à Pro pour des comptes illimités.',
  'error.featureRestricted': 'Cette fonctionnalité nécessite un abonnement {{tier}}.',

  // Subscription
  'subscription.free': 'Gratuit',
  'subscription.pro': 'Pro',
  'subscription.team': 'Équipe',
  'subscription.upgrade': 'Mettre à niveau',
  'subscription.gracePeriod': 'Problème de paiement. {{days}} jours restants avant rétrogradation.',

  // AI Scheduling
  'ai.suggest': 'Suggérer des horaires',
  'ai.noSlots': 'Aucun créneau disponible trouvé.',
  'ai.conflict': 'Conflit détecté avec {{event}}',

  // Privacy
  'privacy.public': 'Public',
  'privacy.busyOnly': 'Occupé uniquement',
  'privacy.private': 'Privé',

  // Greeting / interpolation
  'greeting': 'Bonjour, {{name}} !',
  'items.count': '{{count}} éléments',
};

export default fr;
