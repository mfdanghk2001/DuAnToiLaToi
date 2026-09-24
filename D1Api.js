function apiD1ListDocuments(filters) {
  return D1DocumentService.list(filters || {});
}

function apiD1GetDocument(documentId) {
  return D1DocumentService.get(documentId);
}

function apiD1CreateDocument(payload) {
  return D1DocumentService.create(payload || {});
}

function apiD1UpdateDocument(documentId, payload) {
  return D1DocumentService.update(documentId, payload || {});
}

function apiD1UpdateDocumentProcessing(documentId, payload) {
  return D1DocumentService.updateProcessing(documentId, payload || {});
}

function apiD1AddDocumentFile(documentId, file) {
  return D1DocumentService.addFile(documentId, file || {});
}

function apiD1AddDocumentNote(documentId, note) {
  return D1DocumentService.addNote(documentId, note || '');
}

function apiD1ArchiveDocument(documentId, note) {
  return D1DocumentService.archive(documentId, note || '');
}

function apiD1CreateTaskFromDocument(documentId, payload) {
  return D1DocumentService.createTask(documentId, payload || {});
}