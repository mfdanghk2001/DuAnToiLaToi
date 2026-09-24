function apiF1ListCalendar(filters) {
  return F1CompleteService.calendarList(filters || {});
}

function apiF1CreateCalendar(payload) {
  return F1CompleteService.createCalendar(payload || {});
}

function apiF1UpdateCalendar(eventId, payload) {
  return F1CompleteService.updateCalendar(eventId, payload || {});
}

function apiF1CancelCalendar(eventId) {
  return F1CompleteService.cancelCalendar(eventId);
}

function apiF1ListMeetings(filters) {
  return F1CompleteService.meetingList(filters || {});
}

function apiF1GetMeeting(meetingId) {
  return F1CompleteService.meetingGet(meetingId);
}

function apiF1CreateMeeting(payload) {
  return F1CompleteService.createMeeting(payload || {});
}

function apiF1UpdateMeeting(meetingId, payload) {
  return F1CompleteService.updateMeeting(meetingId, payload || {});
}

function apiF1SaveMeetingNotes(meetingId, payload) {
  return F1CompleteService.saveMeetingNotes(meetingId, payload || {});
}

function apiF1AddMeetingFile(meetingId, file, kind) {
  return F1CompleteService.addMeetingFile(meetingId, file || {}, kind || 'MATERIAL');
}

function apiF1ListRepository(folderId) {
  return F1CompleteService.repositoryList(folderId || '');
}

function apiF1CreateRepositoryFolder(parentId, name) {
  return F1CompleteService.repositoryCreateFolder(parentId || '', name || '');
}

function apiF1UploadRepositoryFile(parentId, file) {
  return F1CompleteService.repositoryUpload(parentId || '', file || {});
}

function apiF1RenameRepositoryItem(itemType, itemId, name) {
  return F1CompleteService.repositoryRename(itemType, itemId, name);
}

function apiF1TrashRepositoryItem(itemType, itemId) {
  return F1CompleteService.repositoryTrash(itemType, itemId);
}

function apiF1FavoriteRepositoryItem(itemType, itemId, value) {
  return F1CompleteService.repositoryFavorite(itemType, itemId, Boolean(value));
}

function apiF1SearchRepository(query) {
  return F1CompleteService.repositorySearch(query || '');
}

function apiF1RecentRepository() {
  return F1CompleteService.repositoryRecent();
}

function apiF1FavoriteRepositoryItems() {
  return F1CompleteService.repositoryFavorites();
}

function apiF1GetReport(filters) {
  return F1CompleteService.reportData(filters || {});
}

function apiF1ExportReportPdf(filters) {
  return F1CompleteService.exportReportPdf(filters || {});
}

function apiF1Diagnostics() {
  return F1CompleteService.diagnostics();
}

function apiF1InstallReminderTrigger() {
  return F1CompleteService.installReminderTrigger();
}

function apiF1CreateBackup() {
  return F1CompleteService.createBackup();
}

function apiF1GlobalSearch(query) {
  return F1CompleteService.globalSearch(query || '');
}