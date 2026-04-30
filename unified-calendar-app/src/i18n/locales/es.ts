/**
 * Spanish translations.
 * Requirements: 11.6
 */

const es: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Bienvenido a Unified Calendar',
  'onboarding.welcome.subtitle': 'Todos tus calendarios en un solo lugar',
  'onboarding.connect.title': 'Conecta tu primera cuenta',
  'onboarding.connect.subtitle': 'Vincula Google, Outlook, iCloud o CalDAV',
  'onboarding.view.title': 'Elige tu vista',
  'onboarding.view.subtitle': 'Día, semana, mes o agenda — elige tu predeterminada',
  'onboarding.explore.title': 'Explora las funciones',
  'onboarding.explore.subtitle': 'Descubre la programación con IA, detección de conflictos y más',
  'onboarding.skip': 'Omitir',
  'onboarding.next': 'Siguiente',
  'onboarding.done': 'Comenzar',

  // Common UI
  'common.save': 'Guardar',
  'common.cancel': 'Cancelar',
  'common.delete': 'Eliminar',
  'common.edit': 'Editar',
  'common.close': 'Cerrar',
  'common.back': 'Atrás',
  'common.confirm': 'Confirmar',
  'common.retry': 'Reintentar',
  'common.settings': 'Configuración',
  'common.search': 'Buscar',
  'common.loading': 'Cargando…',
  'common.ok': 'Aceptar',

  // Calendar views
  'calendar.day': 'Día',
  'calendar.week': 'Semana',
  'calendar.month': 'Mes',
  'calendar.agenda': 'Agenda',
  'calendar.today': 'Hoy',
  'calendar.noEvents': 'Sin eventos',

  // Events
  'event.create': 'Nuevo evento',
  'event.edit': 'Editar evento',
  'event.delete': 'Eliminar evento',
  'event.deleteConfirm': '¿Estás seguro de que quieres eliminar este evento?',
  'event.title': 'Título',
  'event.location': 'Ubicación',
  'event.description': 'Descripción',
  'event.startTime': 'Hora de inicio',
  'event.endTime': 'Hora de fin',
  'event.allDay': 'Todo el día',
  'event.recurrence': 'Recurrencia',
  'event.calendar': 'Calendario',
  'event.attendees': 'Asistentes',

  // Accounts
  'account.connect': 'Conectar cuenta',
  'account.remove': 'Eliminar cuenta',
  'account.removeConfirm': '¿Eliminar esta cuenta? Todos los datos locales serán borrados.',
  'account.google': 'Google Calendar',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': 'Sincronizando…',
  'sync.lastSynced': 'Última sincronización: {{time}}',
  'sync.offline': 'Estás sin conexión. Los cambios se sincronizarán al reconectar.',
  'sync.error': 'Error de sincronización. Toca para más detalles.',
  'sync.conflict': 'Conflicto de sincronización detectado',

  // Errors
  'error.generic': 'Algo salió mal. Por favor, inténtalo de nuevo.',
  'error.network': 'Error de red. Verifica tu conexión.',
  'error.auth': 'Autenticación fallida. Por favor, reconecta tu cuenta.',
  'error.accountLimit': 'Límite de cuentas alcanzado. Actualiza a Pro para cuentas ilimitadas.',
  'error.featureRestricted': 'Esta función requiere una suscripción {{tier}}.',

  // Subscription
  'subscription.free': 'Gratuito',
  'subscription.pro': 'Pro',
  'subscription.team': 'Equipo',
  'subscription.upgrade': 'Actualizar',
  'subscription.gracePeriod': 'Problema de pago. {{days}} días restantes antes de la degradación.',

  // AI Scheduling
  'ai.suggest': 'Sugerir horarios',
  'ai.noSlots': 'No se encontraron horarios disponibles.',
  'ai.conflict': 'Conflicto detectado con {{event}}',

  // Privacy
  'privacy.public': 'Público',
  'privacy.busyOnly': 'Solo Ocupado',
  'privacy.private': 'Privado',

  // Greeting / interpolation
  'greeting': '¡Hola, {{name}}!',
  'items.count': '{{count}} elementos',
};

export default es;
