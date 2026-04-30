/**
 * Simplified Chinese translations.
 * Requirements: 11.6
 */

const zhCN: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': '欢迎使用 Unified Calendar',
  'onboarding.welcome.subtitle': '所有日历集于一处',
  'onboarding.connect.title': '连接您的第一个账户',
  'onboarding.connect.subtitle': '关联 Google、Outlook、iCloud 或 CalDAV',
  'onboarding.view.title': '选择您的视图',
  'onboarding.view.subtitle': '日、周、月或日程 — 选择您的默认视图',
  'onboarding.explore.title': '探索功能',
  'onboarding.explore.subtitle': '发现 AI 日程安排、冲突检测等功能',
  'onboarding.skip': '跳过',
  'onboarding.next': '下一步',
  'onboarding.done': '开始使用',

  // Common UI
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.close': '关闭',
  'common.back': '返回',
  'common.confirm': '确认',
  'common.retry': '重试',
  'common.settings': '设置',
  'common.search': '搜索',
  'common.loading': '加载中…',
  'common.ok': '确定',

  // Calendar views
  'calendar.day': '日',
  'calendar.week': '周',
  'calendar.month': '月',
  'calendar.agenda': '日程',
  'calendar.today': '今天',
  'calendar.noEvents': '无事件',

  // Events
  'event.create': '新建事件',
  'event.edit': '编辑事件',
  'event.delete': '删除事件',
  'event.deleteConfirm': '确定要删除此事件吗？',
  'event.title': '标题',
  'event.location': '地点',
  'event.description': '描述',
  'event.startTime': '开始时间',
  'event.endTime': '结束时间',
  'event.allDay': '全天',
  'event.recurrence': '重复',
  'event.calendar': '日历',
  'event.attendees': '参与者',

  // Accounts
  'account.connect': '连接账户',
  'account.remove': '移除账户',
  'account.removeConfirm': '移除此账户？所有本地数据将被删除。',
  'account.google': 'Google 日历',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': '同步中…',
  'sync.lastSynced': '上次同步: {{time}}',
  'sync.offline': '您已离线。重新连接后将同步更改。',
  'sync.error': '同步错误。点击查看详情。',
  'sync.conflict': '检测到同步冲突',

  // Errors
  'error.generic': '出了点问题，请重试。',
  'error.network': '网络错误，请检查您的连接。',
  'error.auth': '认证失败。请重新连接您的账户。',
  'error.accountLimit': '已达账户上限。升级到 Pro 可使用无限账户。',
  'error.featureRestricted': '此功能需要{{tier}}订阅。',

  // Subscription
  'subscription.free': '免费',
  'subscription.pro': 'Pro',
  'subscription.team': '团队',
  'subscription.upgrade': '升级',
  'subscription.gracePeriod': '支付问题。距降级还有{{days}}天。',

  // AI Scheduling
  'ai.suggest': '建议时间',
  'ai.noSlots': '未找到可用时间段。',
  'ai.conflict': '检测到与{{event}}的冲突',

  // Privacy
  'privacy.public': '公开',
  'privacy.busyOnly': '仅显示忙碌',
  'privacy.private': '私密',

  // Greeting / interpolation
  'greeting': '你好，{{name}}！',
  'items.count': '{{count}} 个项目',
};

export default zhCN;
