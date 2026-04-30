/**
 * Arabic translations (RTL language).
 * Requirements: 11.6
 */

const ar: Record<string, string> = {
  // Onboarding
  'onboarding.welcome.title': 'مرحبًا بك في Unified Calendar',
  'onboarding.welcome.subtitle': 'جميع تقويماتك في مكان واحد',
  'onboarding.connect.title': 'اربط حسابك الأول',
  'onboarding.connect.subtitle': 'اربط Google أو Outlook أو iCloud أو CalDAV',
  'onboarding.view.title': 'اختر طريقة العرض',
  'onboarding.view.subtitle': 'يوم أو أسبوع أو شهر أو جدول أعمال — اختر الافتراضي',
  'onboarding.explore.title': 'استكشف الميزات',
  'onboarding.explore.subtitle': 'اكتشف الجدولة بالذكاء الاصطناعي واكتشاف التعارضات والمزيد',
  'onboarding.skip': 'تخطي',
  'onboarding.next': 'التالي',
  'onboarding.done': 'ابدأ',

  // Common UI
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.delete': 'حذف',
  'common.edit': 'تعديل',
  'common.close': 'إغلاق',
  'common.back': 'رجوع',
  'common.confirm': 'تأكيد',
  'common.retry': 'إعادة المحاولة',
  'common.settings': 'الإعدادات',
  'common.search': 'بحث',
  'common.loading': 'جارٍ التحميل…',
  'common.ok': 'موافق',

  // Calendar views
  'calendar.day': 'يوم',
  'calendar.week': 'أسبوع',
  'calendar.month': 'شهر',
  'calendar.agenda': 'جدول الأعمال',
  'calendar.today': 'اليوم',
  'calendar.noEvents': 'لا توجد أحداث',

  // Events
  'event.create': 'حدث جديد',
  'event.edit': 'تعديل الحدث',
  'event.delete': 'حذف الحدث',
  'event.deleteConfirm': 'هل أنت متأكد أنك تريد حذف هذا الحدث؟',
  'event.title': 'العنوان',
  'event.location': 'الموقع',
  'event.description': 'الوصف',
  'event.startTime': 'وقت البدء',
  'event.endTime': 'وقت الانتهاء',
  'event.allDay': 'طوال اليوم',
  'event.recurrence': 'التكرار',
  'event.calendar': 'التقويم',
  'event.attendees': 'الحضور',

  // Accounts
  'account.connect': 'ربط حساب',
  'account.remove': 'إزالة الحساب',
  'account.removeConfirm': 'إزالة هذا الحساب؟ سيتم حذف جميع البيانات المحلية.',
  'account.google': 'تقويم Google',
  'account.outlook': 'Microsoft Outlook',
  'account.icloud': 'Apple iCloud',
  'account.exchange': 'Exchange',
  'account.caldav': 'CalDAV',

  // Sync
  'sync.syncing': 'جارٍ المزامنة…',
  'sync.lastSynced': 'آخر مزامنة: {{time}}',
  'sync.offline': 'أنت غير متصل. ستتم مزامنة التغييرات عند إعادة الاتصال.',
  'sync.error': 'خطأ في المزامنة. انقر للتفاصيل.',
  'sync.conflict': 'تم اكتشاف تعارض في المزامنة',

  // Errors
  'error.generic': 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
  'error.network': 'خطأ في الشبكة. تحقق من اتصالك.',
  'error.auth': 'فشلت المصادقة. يرجى إعادة ربط حسابك.',
  'error.accountLimit': 'تم الوصول إلى حد الحسابات. قم بالترقية إلى Pro لحسابات غير محدودة.',
  'error.featureRestricted': 'تتطلب هذه الميزة اشتراك {{tier}}.',

  // Subscription
  'subscription.free': 'مجاني',
  'subscription.pro': 'Pro',
  'subscription.team': 'فريق',
  'subscription.upgrade': 'ترقية',
  'subscription.gracePeriod': 'مشكلة في الدفع. {{days}} أيام متبقية قبل التخفيض.',

  // AI Scheduling
  'ai.suggest': 'اقتراح أوقات',
  'ai.noSlots': 'لم يتم العثور على فترات زمنية متاحة.',
  'ai.conflict': 'تم اكتشاف تعارض مع {{event}}',

  // Privacy
  'privacy.public': 'عام',
  'privacy.busyOnly': 'مشغول فقط',
  'privacy.private': 'خاص',

  // Greeting / interpolation
  'greeting': 'مرحبًا، {{name}}!',
  'items.count': '{{count}} عناصر',
};

export default ar;
