function apiGetCurrentUser() {
  return AuthService.getCurrentUser();
}

function apiBootstrapB2() {
  const info = SystemConfig.getSystemInfo();
  if (!info.initialized) {
    return {ok:false, error:'NOT_INITIALIZED', message:'Hệ thống chưa được khởi tạo. Hãy chạy setupSystem().'};
  }

  const user = AuthService.getCurrentUser();
  if (!user.authenticated) {
    return {ok:false, error:'UNAUTHORIZED', message:user.message || 'Tài khoản chưa được cấp quyền.', user};
  }

  return {
    ok:true,
    user,
    users:UserService.listActive(),
    dashboard:DashboardService.get(),
    documents:DocumentService.list(),
    tasks:TaskService.list(),
    calendarEvents:CalendarService.list(),
    meetings:MeetingService.list()
  };
}

function apiRefreshB2() {
  return {
    ok:true,
    dashboard:DashboardService.get(),
    documents:DocumentService.list(),
    tasks:TaskService.list(),
    calendarEvents:CalendarService.list(),
    meetings:MeetingService.list()
  };
}

function apiListDocuments() {
  return DocumentService.list();
}

function apiCreateDocument(payload) {
  return DocumentService.create(payload || {});
}

function apiListTasks() {
  return TaskService.list();
}

function apiCreateTask(payload) {
  return TaskService.create(payload || {});
}

function apiUpdateTaskProgress(taskId, progress, status, note) {
  return TaskService.updateProgress(taskId, progress, status, note);
}

function apiGetCategories(type) {
  const all = RepositoryService.getAll('CATEGORIES');
  if (!type) return all;
  return all.filter(x => x.category_type === type && x.status === 'ACTIVE');
}

function apiGetDepartments() {
  return RepositoryService.getAll('DEPARTMENTS').filter(x => x.status === 'ACTIVE');
}

function apiSystemHealth() {
  const info = SystemConfig.getSystemInfo();
  return {
    ok: info.initialized,
    system: info,
    user: info.initialized ? AuthService.getCurrentUser() : null
  };
}

function apiListCalendarEvents() {
  return CalendarService.list();
}

function apiCreateCalendarEvent(payload) {
  return CalendarService.create(payload || {});
}

function apiListMeetings() {
  return MeetingService.list();
}

function apiCreateMeeting(payload) {
  return MeetingService.create(payload || {});
}

function apiUpdateMeetingAgenda(meetingId, agenda) {
  return MeetingService.updateAgenda(meetingId, agenda);
}

function apiCreateTaskFromMeeting(meetingId, payload) {
  return MeetingService.createTaskFromConclusion(
    meetingId,
    payload || {}
  );
}