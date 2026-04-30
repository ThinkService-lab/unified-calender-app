/**
 * Korean translations.
 * Requirements: 11.6
 */

const ko: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'Unified Calendar에 오신 것을 환영합니다',
  'onboarding.welcome.subtitle': '모든 캘린더를 한 곳에서',
  'onboarding.connect.title': '첫 번째 계정 연결',
  'onboarding.connect.subtitle': 'Google, Outlook, iCloud 또는 CalDAV 연결',
  'onboarding.view.title': '보기 선택',
  'onboarding.view.subtitle': '일, 주, 월 또는 일정 — 기본 보기를 선택하세요',
  'onboarding.explore.title': '기능 탐색',
  'onboarding.explore.subtitle': 'AI 일정 관리, 충돌 감지 등을 발견하세요',
  'onboarding.skip': '건너뛰기',
  'onboarding.next': '다음',
  'onboarding.done': '시작하기',

  // Common UI
  'common.save': '저장',
  'common.cancel': '취소',
  'common.delete': '삭제',
  'common.edit': '편집',
  'common.close': '닫기',
  'common.back': '뒤로',
  'common.confirm': '확인',
  'common.retry': '재시도',
  'common.settings': '설정',
  'common.search': '검색',
  'common.loading': '로딩 중…',
  'common.ok': '확인',

  // Calendar views
  'calendar.day': '일',
  'calendar.week': '주',
  'calendar.month': '월',
  'calendar.agenda': '일정',
  'calendar.today': '오늘',
  'calendar.noEvents': '일정 없음',

  // Events
  'event.create': '새 일정',
  'event.edit': '일정 편집',
  'event.delete': '일정 삭제',
  'event.deleteConfirm': '이 일정을 삭제하시겠습니까?',
  'event.title': '제목',
  'event.location': '장소',
  'event.description': '설명',
  'event.startTime': '시작 시간',
  'event.endTime': '종료 시간',
  'event.allDay': '종일',
  'event.recurrence': '반복',
  'event.calendar': '캘린더',
  'event.attendees': '참석자',

  // Accounts
  'account.connect': '계정 연결',
  'account.remove': '계정 제거',
  'account.removeConfirm': '이 계정을 제거하시겠습니까? 모든 로컬 데이터가 삭제됩니다.',
  'account.google': 'Google 캘린더',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': '동기화 중…',
  'sync.lastSynced': '마지막 동기화: {{time}}',
  'sync.offline': '오프라인 상태입니다. 재연결 시 변경사항이 동기화됩니다.',
  'sync.error': '동기화 오류. 탭하여 자세히 보기.',
  'sync.conflict': '동기화 충돌이 감지되었습니다',

  // Errors
  'error.generic': '문제가 발생했습니다. 다시 시도해 주세요.',
  'error.network': '네트워크 오류. 연결을 확인하세요.',
  'error.auth': '인증에 실패했습니다. 계정을 다시 연결해 주세요.',
  'error.accountLimit': '계정 한도에 도달했습니다. Pro로 업그레이드하여 무제한으로 사용하세요.',
  'error.featureRestricted': '이 기능은 {{tier}} 구독이 필요합니다.',

  // Subscription
  'subscription.free': '무료',
  'subscription.pro': 'Pro',
  'subscription.team': '팀',
  'subscription.upgrade': '업그레이드',
  'subscription.gracePeriod': '결제 문제. 다운그레이드까지 {{days}}일 남음.',

  // AI Scheduling
  'ai.suggest': '시간 제안',
  'ai.noSlots': '사용 가능한 시간대를 찾을 수 없습니다.',
  'ai.conflict': '{{event}}과(와) 충돌이 감지되었습니다',

  // Privacy
  'privacy.public': '공개',
  'privacy.busyOnly': '바쁨만 표시',
  'privacy.private': '비공개',

  // Greeting / interpolation
  'greeting': '안녕하세요, {{name}}님!',
  'items.count': '{{count}}개 항목',
};

export default ko;
