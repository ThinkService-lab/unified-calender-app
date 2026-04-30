/**
 * Japanese translations.
 * Requirements: 11.6
 */

const ja: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Unified Calendarへようこそ',
  'onboarding.welcome.subtitle': 'すべてのカレンダーを一か所に',
  'onboarding.connect.title': '最初のアカウントを接続',
  'onboarding.connect.subtitle': 'Google、Outlook、iCloud、CalDAVを連携',
  'onboarding.view.title': '表示を選択',
  'onboarding.view.subtitle': '日・週・月・予定一覧から既定の表示を選択',
  'onboarding.explore.title': '機能を探索',
  'onboarding.explore.subtitle': 'AIスケジューリング、競合検出などを発見',
  'onboarding.skip': 'スキップ',
  'onboarding.next': '次へ',
  'onboarding.done': '始める',

  // Common UI
  'common.save': '保存',
  'common.cancel': 'キャンセル',
  'common.delete': '削除',
  'common.edit': '編集',
  'common.close': '閉じる',
  'common.back': '戻る',
  'common.confirm': '確認',
  'common.retry': '再試行',
  'common.settings': '設定',
  'common.search': '検索',
  'common.loading': '読み込み中…',
  'common.ok': 'OK',

  // Calendar views
  'calendar.day': '日',
  'calendar.week': '週',
  'calendar.month': '月',
  'calendar.agenda': '予定一覧',
  'calendar.today': '今日',
  'calendar.noEvents': '予定なし',

  // Events
  'event.create': '新しい予定',
  'event.edit': '予定を編集',
  'event.delete': '予定を削除',
  'event.deleteConfirm': 'この予定を削除してもよろしいですか？',
  'event.title': 'タイトル',
  'event.location': '場所',
  'event.description': '説明',
  'event.startTime': '開始時刻',
  'event.endTime': '終了時刻',
  'event.allDay': '終日',
  'event.recurrence': '繰り返し',
  'event.calendar': 'カレンダー',
  'event.attendees': '参加者',

  // Accounts
  'account.connect': 'アカウントを接続',
  'account.remove': 'アカウントを削除',
  'account.removeConfirm': 'このアカウントを削除しますか？すべてのローカルデータが削除されます。',
  'account.google': 'Googleカレンダー',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': '同期中…',
  'sync.lastSynced': '最終同期: {{time}}',
  'sync.offline': 'オフラインです。再接続時に変更が同期されます。',
  'sync.error': '同期エラー。タップして詳細を表示。',
  'sync.conflict': '同期の競合が検出されました',

  // Errors
  'error.generic': '問題が発生しました。もう一度お試しください。',
  'error.network': 'ネットワークエラー。接続を確認してください。',
  'error.auth': '認証に失敗しました。アカウントを再接続してください。',
  'error.accountLimit': 'アカウント上限に達しました。Proにアップグレードして無制限に。',
  'error.featureRestricted': 'この機能には{{tier}}サブスクリプションが必要です。',

  // Subscription
  'subscription.free': '無料',
  'subscription.pro': 'Pro',
  'subscription.team': 'チーム',
  'subscription.upgrade': 'アップグレード',
  'subscription.gracePeriod': '支払いの問題。ダウングレードまで{{days}}日。',

  // AI Scheduling
  'ai.suggest': '時間を提案',
  'ai.noSlots': '利用可能な時間帯が見つかりません。',
  'ai.conflict': '{{event}}との競合が検出されました',

  // Privacy
  'privacy.public': '公開',
  'privacy.busyOnly': '予定ありのみ',
  'privacy.private': '非公開',

  // Greeting / interpolation
  'greeting': 'こんにちは、{{name}}さん！',
  'items.count': '{{count}}件',
};

export default ja;
