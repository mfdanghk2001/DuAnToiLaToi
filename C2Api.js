function apiC2SaveDraft(payload) {
  return C2DraftService.saveDraft(payload || {});
}

function apiC2ListDrafts() {
  return C2DraftService.listMyDrafts();
}

function apiC2GetDraft(draftId) {
  return C2DraftService.getDraft(draftId);
}

function apiC2LinkDraft(draftId, sourceType, sourceId) {
  return C2DraftService.linkDraft(draftId, sourceType || '', sourceId || '');
}

function apiC2ListDraftsForSource(sourceType, sourceId) {
  return C2DraftService.listForSource(sourceType || '', sourceId || '');
}

function apiC2ExportDraftToGoogleDoc(draftId) {
  return C2DraftService.exportToGoogleDoc(draftId);
}