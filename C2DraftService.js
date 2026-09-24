const C2DraftService = (() => {
  const VALID_SOURCE_TYPES = ['', 'DOCUMENT', 'MEETING'];
  const VALID_STATUSES = ['DRAFT', 'EXPORTED'];

  function me_() {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated) throw new Error('Chưa đăng nhập.');
    AuthService.requirePermission('advisory.use');
    return me;
  }

  function getDraftRaw_(draftId) {
    const draft = RepositoryService.findById('DRAFTS','draft_id',draftId);
    if (!draft) throw new Error('Không tìm thấy bản nháp.');
    return draft;
  }

  function requireDraftAccess_(draft) {
    const me = me_();
    if (draft.created_by !== me.userId && me.role !== 'ADMIN') {
      throw new Error('Bạn không có quyền truy cập bản nháp này.');
    }
    return me;
  }

  function normalizeSource_(type, id) {
    type = String(type || '').trim().toUpperCase();
    id = String(id || '').trim();

    if (!VALID_SOURCE_TYPES.includes(type)) {
      throw new Error('Loại hồ sơ liên kết không hợp lệ.');
    }
    if (!type) return {source_type:'', source_id:''};
    if (!id) throw new Error('Bạn chưa chọn hồ sơ cần liên kết.');

    if (type === 'DOCUMENT') {
      AuthService.requirePermission('documents.view');
      if (!RepositoryService.findById('DOCUMENTS','document_id',id)) {
        throw new Error('Không tìm thấy văn bản.');
      }
    }

    if (type === 'MEETING') {
      AuthService.requirePermission('meetings.view');
      if (!RepositoryService.findById('MEETINGS','meeting_id',id)) {
        throw new Error('Không tìm thấy cuộc họp.');
      }
    }

    return {source_type:type, source_id:id};
  }

  function titleFrom_(payload) {
    const manual = String(payload.title || '').trim();
    if (manual) return manual.slice(0, 180);

    const taskNames = {
      DRAFT:'Dự thảo văn bản',
      SUMMARY:'Tóm tắt tài liệu',
      REVIEW:'Rà soát dự thảo',
      CONCLUSION:'Dự thảo thông báo kết luận',
      REPORT:'Tổng hợp báo cáo',
      GENERAL:'Nội dung tham mưu'
    };

    const base = taskNames[String(payload.draft_type || '').toUpperCase()] || 'Bản nháp tham mưu';
    return `${base} - ${Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy HH:mm')}`;
  }

  function serialize_(d) {
    return {
      ...d,
      version: Number(d.version || 1),
      drive_url: d.drive_file_id
        ? ('https://docs.google.com/document/d/' + d.drive_file_id + '/edit')
        : ''
    };
  }

  function saveDraft(payload) {
    const me = me_();
    payload = payload || {};

    const content = String(payload.content || '').trim();
    if (!content) throw new Error('Nội dung bản nháp đang trống.');

    const source = normalizeSource_(payload.source_type, payload.source_id);
    const now = new Date();

    if (payload.draft_id) {
      const current = getDraftRaw_(payload.draft_id);
      requireDraftAccess_(current);

      const updated = RepositoryService.updateById(
        'DRAFTS','draft_id',current.draft_id,{
          draft_type: String(payload.draft_type || current.draft_type || 'GENERAL').toUpperCase(),
          title: titleFrom_(payload),
          content_html: content,
          source_type: source.source_type,
          source_id: source.source_id,
          status: current.status || 'DRAFT',
          version: Number(current.version || 1) + 1,
          updated_at: now
        }
      );

      ActivityService.log('UPDATE','DRAFT',current.draft_id,{
        title: updated.title,
        version: updated.version
      });

      return serialize_(updated);
    }

    const data = {
      draft_id: uuid_(),
      draft_type: String(payload.draft_type || 'GENERAL').toUpperCase(),
      title: titleFrom_(payload),
      content_html: content,
      template_id: String(payload.template_id || ''),
      source_type: source.source_type,
      source_id: source.source_id,
      status: 'DRAFT',
      version: 1,
      drive_file_id: '',
      created_by: me.userId,
      created_at: now,
      updated_at: now
    };

    RepositoryService.append('DRAFTS', data);
    ActivityService.log('CREATE','DRAFT',data.draft_id,{
      title:data.title,
      draftType:data.draft_type
    });

    return serialize_(data);
  }

  function listMyDrafts() {
    const me = me_();

    return RepositoryService.getAll('DRAFTS')
      .filter(d => d.created_by === me.userId || me.role === 'ADMIN')
      .sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, 80)
      .map(d => ({
        draft_id:d.draft_id,
        draft_type:d.draft_type,
        title:d.title,
        source_type:d.source_type,
        source_id:d.source_id,
        status:d.status,
        version:Number(d.version || 1),
        drive_file_id:d.drive_file_id,
        drive_url:d.drive_file_id
          ? ('https://docs.google.com/document/d/' + d.drive_file_id + '/edit')
          : '',
        created_by:d.created_by,
        created_at:d.created_at,
        updated_at:d.updated_at
      }));
  }

  function getDraft(draftId) {
    const draft = getDraftRaw_(draftId);
    requireDraftAccess_(draft);
    return serialize_(draft);
  }

  function linkDraft(draftId, sourceType, sourceId) {
    const draft = getDraftRaw_(draftId);
    requireDraftAccess_(draft);

    const source = normalizeSource_(sourceType, sourceId);

    const updated = RepositoryService.updateById(
      'DRAFTS','draft_id',draftId,{
        source_type:source.source_type,
        source_id:source.source_id,
        updated_at:new Date()
      }
    );

    ActivityService.log('UPDATE','DRAFT',draftId,{
      source_type:source.source_type,
      source_id:source.source_id
    });

    return serialize_(updated);
  }

  function listForSource(sourceType, sourceId) {
    me_();
    const source = normalizeSource_(sourceType, sourceId);

    if (!source.source_type) return [];

    return RepositoryService.getAll('DRAFTS')
      .filter(d =>
        d.source_type === source.source_type &&
        String(d.source_id) === String(source.source_id)
      )
      .sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .map(d => ({
        draft_id:d.draft_id,
        draft_type:d.draft_type,
        title:d.title,
        status:d.status,
        version:Number(d.version || 1),
        drive_file_id:d.drive_file_id,
        drive_url:d.drive_file_id
          ? ('https://docs.google.com/document/d/' + d.drive_file_id + '/edit')
          : '',
        updated_at:d.updated_at
      }));
  }

  function exportToGoogleDoc(draftId) {
    const draft = getDraftRaw_(draftId);
    requireDraftAccess_(draft);

    const doc = DocumentApp.create(draft.title || 'Bản nháp tham mưu');
    const docId = doc.getId();
    const body = doc.getBody();

    body.clear();

    body.appendParagraph('BẢN NHÁP HỖ TRỢ')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);

    body.appendParagraph(draft.title || 'Bản nháp tham mưu')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);

    body.appendParagraph(
      'Lưu ý: Nội dung do Trợ lý tham mưu hỗ trợ tạo. Cán bộ cần kiểm tra trước khi trình hoặc ban hành.'
    ).setItalic(true);

    body.appendHorizontalRule();

    writeContent_(body, String(draft.content_html || ''));

    body.appendHorizontalRule();
    body.appendParagraph(
      'Phiên bản: ' + Number(draft.version || 1) +
      ' · Xuất lúc: ' +
      Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','dd/MM/yyyy HH:mm')
    ).setForegroundColor('#64748B');

    doc.saveAndClose();

    const draftsFolderId = DriveService.getFolderIdByKey('DRAFTS');
    const file = DriveApp.getFileById(docId);
    file.moveTo(DriveApp.getFolderById(draftsFolderId));

    const updated = RepositoryService.updateById(
      'DRAFTS','draft_id',draftId,{
        drive_file_id:docId,
        status:'EXPORTED',
        updated_at:new Date()
      }
    );

    ActivityService.log('EXPORT_DOC','DRAFT',draftId,{
      title:draft.title,
      driveFileId:docId
    });

    return {
      ...serialize_(updated),
      drive_url:'https://docs.google.com/document/d/' + docId + '/edit'
    };
  }

  function writeContent_(body, text) {
    const lines = text.replace(/\r\n/g,'\n').split('\n');

    lines.forEach(raw => {
      const line = raw.trimEnd();

      if (!line.trim()) {
        body.appendParagraph('');
        return;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const p = body.appendParagraph(heading[2].trim());
        p.setHeading(
          level === 1
            ? DocumentApp.ParagraphHeading.HEADING1
            : level === 2
              ? DocumentApp.ParagraphHeading.HEADING2
              : DocumentApp.ParagraphHeading.HEADING3
        );
        return;
      }

      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        body.appendListItem(bullet[1].trim())
          .setGlyphType(DocumentApp.GlyphType.BULLET);
        return;
      }

      const numbered = line.match(/^\s*\d+[\.\)]\s+(.+)$/);
      if (numbered) {
        body.appendListItem(numbered[1].trim())
          .setGlyphType(DocumentApp.GlyphType.NUMBER);
        return;
      }

      body.appendParagraph(line);
    });
  }

  return {
    saveDraft,
    listMyDrafts,
    getDraft,
    linkDraft,
    listForSource,
    exportToGoogleDoc
  };
})();