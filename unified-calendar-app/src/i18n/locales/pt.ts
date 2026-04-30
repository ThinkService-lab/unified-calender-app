/**
 * Portuguese translations.
 * Requirements: 11.6
 */

const pt: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Bem-vindo ao Unified Calendar',
  'onboarding.welcome.subtitle': 'Todos os seus calendários em um só lugar',
  'onboarding.connect.title': 'Conecte sua primeira conta',
  'onboarding.connect.subtitle': 'Vincule Google, Outlook, iCloud ou CalDAV',
  'onboarding.view.title': 'Escolha sua visualização',
  'onboarding.view.subtitle': 'Dia, semana, mês ou agenda — escolha seu padrão',
  'onboarding.explore.title': 'Explore os recursos',
  'onboarding.explore.subtitle': 'Descubra agendamento com IA, detecção de conflitos e mais',
  'onboarding.skip': 'Pular',
  'onboarding.next': 'Próximo',
  'onboarding.done': 'Começar',

  // Common UI
  'common.save': 'Salvar',
  'common.cancel': 'Cancelar',
  'common.delete': 'Excluir',
  'common.edit': 'Editar',
  'common.close': 'Fechar',
  'common.back': 'Voltar',
  'common.confirm': 'Confirmar',
  'common.retry': 'Tentar novamente',
  'common.settings': 'Configurações',
  'common.search': 'Pesquisar',
  'common.loading': 'Carregando…',
  'common.ok': 'OK',

  // Calendar views
  'calendar.day': 'Dia',
  'calendar.week': 'Semana',
  'calendar.month': 'Mês',
  'calendar.agenda': 'Agenda',
  'calendar.today': 'Hoje',
  'calendar.noEvents': 'Sem eventos',

  // Events
  'event.create': 'Novo evento',
  'event.edit': 'Editar evento',
  'event.delete': 'Excluir evento',
  'event.deleteConfirm': 'Tem certeza de que deseja excluir este evento?',
  'event.title': 'Título',
  'event.location': 'Local',
  'event.description': 'Descrição',
  'event.startTime': 'Hora de início',
  'event.endTime': 'Hora de término',
  'event.allDay': 'Dia inteiro',
  'event.recurrence': 'Recorrência',
  'event.calendar': 'Calendário',
  'event.attendees': 'Participantes',

  // Accounts
  'account.connect': 'Conectar conta',
  'account.remove': 'Remover conta',
  'account.removeConfirm': 'Remover esta conta? Todos os dados locais serão excluídos.',
  'account.google': 'Google Agenda',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': 'Sincronizando…',
  'sync.lastSynced': 'Última sincronização: {{time}}',
  'sync.offline': 'Você está offline. As alterações serão sincronizadas ao reconectar.',
  'sync.error': 'Erro de sincronização. Toque para detalhes.',
  'sync.conflict': 'Conflito de sincronização detectado',

  // Errors
  'error.generic': 'Algo deu errado. Por favor, tente novamente.',
  'error.network': 'Erro de rede. Verifique sua conexão.',
  'error.auth': 'Autenticação falhou. Por favor, reconecte sua conta.',
  'error.accountLimit': 'Limite de contas atingido. Atualize para Pro para contas ilimitadas.',
  'error.featureRestricted': 'Este recurso requer uma assinatura {{tier}}.',

  // Subscription
  'subscription.free': 'Gratuito',
  'subscription.pro': 'Pro',
  'subscription.team': 'Equipe',
  'subscription.upgrade': 'Atualizar',
  'subscription.gracePeriod': 'Problema de pagamento. {{days}} dias restantes antes do rebaixamento.',

  // AI Scheduling
  'ai.suggest': 'Sugerir horários',
  'ai.noSlots': 'Nenhum horário disponível encontrado.',
  'ai.conflict': 'Conflito detectado com {{event}}',

  // Privacy
  'privacy.public': 'Público',
  'privacy.busyOnly': 'Apenas Ocupado',
  'privacy.private': 'Privado',

  // Greeting / interpolation
  'greeting': 'Olá, {{name}}!',
  'items.count': '{{count}} itens',
};

export default pt;
