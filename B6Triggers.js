function installB6Triggers() {
  const handler = 'runB6ReminderScan';

  // Tránh tạo trùng trigger khi người dùng chạy nhiều lần.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handler)
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyHours(1)
    .create();

  return {
    ok: true,
    message: 'Đã cài trigger nhắc việc mỗi giờ.',
    handler
  };
}

function removeB6Triggers() {
  const handler = 'runB6ReminderScan';
  let removed = 0;

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handler)
    .forEach(t => {
      ScriptApp.deleteTrigger(t);
      removed++;
    });

  return {
    ok: true,
    removed
  };
}

function runB6ReminderScan() {
  return B6NotificationService.scanReminders();
}