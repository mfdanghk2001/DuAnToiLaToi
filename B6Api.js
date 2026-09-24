function apiB6GetNotifications() {
  return B6NotificationService.listForCurrentUser();
}

function apiB6MarkNotificationRead(notificationId) {
  return B6NotificationService.markRead(notificationId);
}

function apiB6MarkAllNotificationsRead() {
  return B6NotificationService.markAllRead();
}

function apiB6GetActivityLogs(limit) {
  return B6ActivityService.getLogs(limit || 200);
}

function apiB6RunReminderScan() {
  const me = AuthService.getCurrentUser();
  if (!me.authenticated || me.role !== 'ADMIN') {
    throw new Error('Chỉ ADMIN được chạy quét nhắc việc thủ công.');
  }
  return B6NotificationService.scanReminders();
}