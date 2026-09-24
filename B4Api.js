function apiB4ListRepository(folderId) {
  return B4RepositoryService.listFolder(folderId || '');
}

function apiB4CreateRepositoryFolder(parentId, name) {
  return B4RepositoryService.createFolder(parentId || '', name);
}

function apiB4UploadRepositoryFile(parentId, file) {
  return B4RepositoryService.upload(parentId || '', file || {});
}

function apiB4SearchRepository(query) {
  return B4RepositoryService.search(query || '');
}

function apiB4GetReportData() {
  return B4ReportService.getReportData();
}