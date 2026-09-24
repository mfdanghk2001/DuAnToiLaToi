function apiD2ListTasks(filters) {
  return D2TaskService.list(filters || {});
}

function apiD2GetTask(taskId) {
  return D2TaskService.get(taskId);
}

function apiD2CreateTask(payload) {
  return D2TaskService.create(payload || {});
}

function apiD2UpdateTask(taskId, payload) {
  return D2TaskService.update(taskId, payload || {});
}

function apiD2UpdateTaskProgress(taskId, payload) {
  return D2TaskService.updateProgress(taskId, payload || {});
}

function apiD2SubmitTaskForApproval(taskId, note) {
  return D2TaskService.submitForApproval(taskId, note || '');
}

function apiD2ApproveTask(taskId, action, note) {
  return D2TaskService.approve(taskId, action || 'APPROVE', note || '');
}

function apiD2CancelTask(taskId, note) {
  return D2TaskService.cancel(taskId, note || '');
}

function apiD2ReopenTask(taskId, note) {
  return D2TaskService.reopen(taskId, note || '');
}

function apiD2AddTaskComment(taskId, note) {
  return D2TaskService.addComment(taskId, note || '');
}

function apiD2AddTaskFile(taskId, file) {
  return D2TaskService.addFile(taskId, file || {});
}