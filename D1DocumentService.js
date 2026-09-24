const D1DocumentService = (() => {
  const FILE_SHEET = 'DOCUMENT_FILES';
  const HISTORY_SHEET = 'DOCUMENT_HISTORY';

  const FILE_HEADERS = [
    'id','document_id','drive_file_id','file_name','mime_type',
    'size','uploaded_by','created_at'
  ];

  const SUPPORT_READY_KEY = 'VPDU_D1_SUPPORT_READY_V1';
  let supportReadyRuntime = false;

  const HISTORY_HEADERS = [
    'history_id','document_id','action','actor_user_id','actor_name',
    'detail_json','created_at'
  ];

  const VALID_DIRECTIONS = ['INCOMING','OUTGOING','DRAFT'];
  const VALID_PRIORITIES = ['NORMAL','HIGH','URGENT'];
  const VALID_STATUSES = [
    'NEW','PROCESSING','WAITING_APPROVAL','COMPLETED','ARCHIVED'
  ];

  function ensureSupportSheets_() {
    if (supportReadyRuntime) return;

    const cache = CacheService.getScriptCache();
    try {
      if (cache.get(SUPPORT_READY_KEY)) {
        supportReadyRuntime = true;
        return;
      }
    } catch (e) {}

    const ss = SystemConfig.getDb();

    if (!ss.getSheetByName(FILE_SHEET)) {
      const sh = ss.insertSheet(FILE_SHEET);
      initSupportSheet_(sh, FILE_HEADERS);
    }

    if (!ss.getSheetByName(HISTORY_SHEET)) {
      const sh = ss.insertSheet(HISTORY_SHEET);
      initSupportSheet_(sh, HISTORY_HEADERS);
    }

    supportReadyRuntime = true;
    try { cache.put(SUPPORT_READY_KEY,'1',21600); } catch (e) {}
  }

  function initSupportSheet_(sh, headers) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length)
      .setFontWeight('bold')
      .setBackground('#991B1B')
      .setFontColor('#FFFFFF')
      .setHorizontalAlignment('center');
    sh.setRowHeight(1,34);
    sh.autoResizeColumns(1,headers.length);
  }

  function me_() {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated) throw new Error('Chưa đăng nhập.');
    return me;
  }

  function clean_(v) {
    return String(v == null ? '' : v).trim();
  }

  function normalizeDirection_(v) {
    const x = clean_(v || 'INCOMING').toUpperCase();
    if (!VALID_DIRECTIONS.includes(x)) throw new Error('Loại văn bản không hợp lệ.');
    return x;
  }

  function normalizePriority_(v) {
    const x = clean_(v || 'NORMAL').toUpperCase();
    if (!VALID_PRIORITIES.includes(x)) throw new Error('Mức độ ưu tiên không hợp lệ.');
    return x;
  }

  function normalizeStatus_(v) {
    const x = clean_(v || 'NEW').toUpperCase();
    if (!VALID_STATUSES.includes(x)) throw new Error('Trạng thái văn bản không hợp lệ.');
    return x;
  }

  function userMap_() {
    const map = {};
    AuthService.listUsersCached().forEach(u => {
      map[u.user_id] = u.full_name || u.email || u.user_id;
    });
    return map;
  }

  function usersForResult_(me) {
    const map = userMap_();
    if (me?.userId && !map[me.userId]) {
      map[me.userId] = me.fullName || me.email || me.userId;
    }
    return map;
  }

  function getDocument_(documentId) {
    const doc = RepositoryService.findById('DOCUMENTS','document_id',documentId);
    if (!doc) throw new Error('Không tìm thấy văn bản.');
    return doc;
  }

  function assertAssignee_(userId) {
    if (!userId) return;
    const u = AuthService.listUsersCached().find(x => x.user_id === userId);
    if (!u || u.status !== 'ACTIVE') {
      throw new Error('Người xử lý không tồn tại hoặc đã ngừng hoạt động.');
    }
  }

  function duplicateNo_(documentNo, direction, ignoreId) {
    const no = clean_(documentNo).toLowerCase();
    if (!no) return null;

    return RepositoryService.getAll('DOCUMENTS').find(d =>
      d.document_id !== ignoreId &&
      String(d.document_no || '').trim().toLowerCase() === no &&
      String(d.direction || '').toUpperCase() === direction &&
      d.status !== 'ARCHIVED'
    ) || null;
  }

  function safeFolderName_(doc) {
    const date = doc.received_date || doc.issued_date || new Date();
    const d = new Date(date);
    const ymd = isNaN(d)
      ? Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd')
      : Utilities.formatDate(d,'Asia/Ho_Chi_Minh','yyyy-MM-dd');

    const no = clean_(doc.document_no || 'Khong-so')
      .replace(/[\\/:*?"<>|#%]/g,'-')
      .replace(/\s+/g,' ')
      .slice(0,45);

    const title = clean_(doc.title || 'Van-ban')
      .replace(/[\\/:*?"<>|#%]/g,'-')
      .replace(/\s+/g,' ')
      .slice(0,55);

    return `${ymd}_${no}_${title}`;
  }

  function rootFolderKey_(direction) {
    if (direction === 'OUTGOING') return 'OUTGOING';
    if (direction === 'DRAFT') return 'DRAFTS';
    return 'INCOMING';
  }

  function ensureDocumentFolder_(doc) {
    if (doc.drive_folder_id) {
      try {
        DriveApp.getFolderById(doc.drive_folder_id);
        return doc.drive_folder_id;
      } catch (e) {}
    }

    const rootId = DriveService.getFolderIdByKey(rootFolderKey_(doc.direction));
    const folder = DriveApp.getFolderById(rootId).createFolder(safeFolderName_(doc));

    RepositoryService.updateById(
      'DOCUMENTS','document_id',doc.document_id,{
        drive_folder_id:folder.getId(),
        updated_at:new Date()
      }
    );

    return folder.getId();
  }

  function addHistory_(documentId, action, detail) {
    ensureSupportSheets_();
    const me = me_();

    RepositoryService.append(HISTORY_SHEET,{
      history_id:uuid_(),
      document_id:documentId,
      action,
      actor_user_id:me.userId,
      actor_name:me.fullName || me.email || '',
      detail_json:JSON.stringify(detail || {}),
      created_at:new Date()
    });
  }

  function serializeFile_(f) {
    return {
      ...f,
      size:Number(f.size || 0),
      url:f.drive_file_id
        ? ('https://drive.google.com/open?id=' + f.drive_file_id)
        : ''
    };
  }

  function legacyFile_(doc, existingIds) {
    if (!doc.drive_file_id || existingIds.has(doc.drive_file_id)) return null;

    try {
      const f = DriveApp.getFileById(doc.drive_file_id);
      return {
        id:'legacy_' + doc.drive_file_id,
        document_id:doc.document_id,
        drive_file_id:doc.drive_file_id,
        file_name:f.getName(),
        mime_type:f.getMimeType(),
        size:f.getSize(),
        uploaded_by:doc.created_by || '',
        created_at:doc.created_at || '',
        url:f.getUrl(),
        legacy:true
      };
    } catch (e) {
      return {
        id:'legacy_' + doc.drive_file_id,
        document_id:doc.document_id,
        drive_file_id:doc.drive_file_id,
        file_name:'Tệp đính kèm cũ',
        mime_type:'',
        size:0,
        uploaded_by:doc.created_by || '',
        created_at:doc.created_at || '',
        url:'https://drive.google.com/open?id=' + doc.drive_file_id,
        legacy:true
      };
    }
  }

  function effectiveStatus_(doc) {
    if (
      doc.status !== 'COMPLETED' &&
      doc.status !== 'ARCHIVED' &&
      doc.due_date
    ) {
      const due = new Date(doc.due_date);
      if (!isNaN(due) && due < new Date()) return 'OVERDUE';
    }
    return doc.status;
  }

  function enrich_(doc, users) {
    return {
      ...doc,
      effective_status:effectiveStatus_(doc),
      assignee_name:users[doc.assignee_user_id] || '',
      created_by_name:users[doc.created_by] || '',
      folder_url:doc.drive_folder_id
        ? ('https://drive.google.com/drive/folders/' + doc.drive_folder_id)
        : ''
    };
  }

  function list(filters) {
    AuthService.requirePermission('documents.view');

    filters = filters || {};
    const q = clean_(filters.q).toLowerCase();
    const direction = clean_(filters.direction || 'ALL').toUpperCase();
    const status = clean_(filters.status || 'ALL').toUpperCase();
    const year = clean_(filters.year || 'ALL');
    const issuer = clean_(filters.issuer || 'ALL');
    const field = clean_(filters.field || 'ALL');
    const assignee = clean_(filters.assignee || 'ALL');
    const priority = clean_(filters.priority || 'ALL').toUpperCase();
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.max(5, Math.min(Number(filters.pageSize || 10), 50));

    const users = userMap_();
    const sourceAll = RepositoryService.getAll('DOCUMENTS');
    let all = sourceAll.map(d => enrich_(d,users));

    // Tổng hợp stat trước filter tab để dashboard bộ lọc ổn định.
    const now = new Date();
    const next48 = new Date(now.getTime() + 48*60*60*1000);
    const stats = {
      total:all.length,
      incoming:all.filter(d => d.direction === 'INCOMING' && d.status !== 'ARCHIVED').length,
      outgoing:all.filter(d => d.direction === 'OUTGOING' && d.status !== 'ARCHIVED').length,
      draft:all.filter(d => d.direction === 'DRAFT' && d.status !== 'ARCHIVED').length,
      archived:all.filter(d => d.status === 'ARCHIVED').length,
      processing:all.filter(d => ['NEW','PROCESSING','WAITING_APPROVAL'].includes(d.status)).length,
      dueSoon:all.filter(d => {
        if (!d.due_date || ['COMPLETED','ARCHIVED'].includes(d.status)) return false;
        const x = new Date(d.due_date);
        return !isNaN(x) && x >= now && x <= next48;
      }).length,
      overdue:all.filter(d => d.effective_status === 'OVERDUE').length
    };

    if (direction !== 'ALL') {
      if (direction === 'ARCHIVED') all = all.filter(d => d.status === 'ARCHIVED');
      else all = all.filter(d => d.direction === direction && d.status !== 'ARCHIVED');
    }

    if (status !== 'ALL') {
      if (status === 'OVERDUE') all = all.filter(d => d.effective_status === 'OVERDUE');
      else all = all.filter(d => d.status === status);
    }

    if (year !== 'ALL') {
      all = all.filter(d => {
        const v = d.received_date || d.issued_date || d.created_at;
        const dt = new Date(v);
        return !isNaN(dt) && String(dt.getFullYear()) === year;
      });
    }

    if (issuer !== 'ALL') all = all.filter(d => clean_(d.issuer) === issuer);
    if (field !== 'ALL') all = all.filter(d => clean_(d.field) === field);
    if (assignee !== 'ALL') all = all.filter(d => d.assignee_user_id === assignee);
    if (priority !== 'ALL') all = all.filter(d => d.priority === priority);

    if (q) {
      all = all.filter(d =>
        [
          d.document_no,d.title,d.summary,d.issuer,d.field,d.document_type,
          d.assignee_name,d.notes
        ].some(v => String(v || '').toLowerCase().includes(q))
      );
    }

    all.sort((a,b) =>
      String(b.received_date || b.created_at || '')
        .localeCompare(String(a.received_date || a.created_at || ''))
    );

    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page,pages);
    const start = (safePage - 1) * pageSize;
    const items = all.slice(start,start + pageSize);

    const years = Array.from(new Set(
      sourceAll.map(d => {
        const dt = new Date(d.received_date || d.issued_date || d.created_at);
        return isNaN(dt) ? '' : String(dt.getFullYear());
      }).filter(Boolean)
    )).sort((a,b) => b.localeCompare(a));

    const issuers = Array.from(new Set(
      sourceAll.map(d => clean_(d.issuer)).filter(Boolean)
    )).sort((a,b) => a.localeCompare(b,'vi'));

    const fields = Array.from(new Set(
      sourceAll.map(d => clean_(d.field)).filter(Boolean)
    )).sort((a,b) => a.localeCompare(b,'vi'));

    return {
      ok:true,
      items,
      stats,
      pagination:{
        page:safePage,
        pageSize,
        total,
        pages,
        from:total ? start + 1 : 0,
        to:Math.min(start + pageSize,total)
      },
      options:{
        years,
        issuers,
        fields,
        users:AuthService.listActiveUsersCached()
          .map(u => ({
            user_id:u.user_id,
            full_name:u.full_name || u.email,
            role:u.role
          }))
      }
    };
  }

  function get(documentId) {
    AuthService.requirePermission('documents.view');
    ensureSupportSheets_();

    const users = userMap_();
    const doc = enrich_(getDocument_(documentId),users);

    const fileRows = RepositoryService.getAll(FILE_SHEET)
      .filter(f => f.document_id === documentId)
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(serializeFile_);

    const ids = new Set(fileRows.map(f => f.drive_file_id));
    const legacy = legacyFile_(doc,ids);
    if (legacy) fileRows.push(legacy);

    const history = RepositoryService.getAll(HISTORY_SHEET)
      .filter(h => h.document_id === documentId)
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(h => {
        let detail = {};
        try { detail = JSON.parse(h.detail_json || '{}'); } catch (e) {}
        return {...h,detail};
      });

    const tasks = RepositoryService.getAll('TASKS')
      .filter(t => t.source_type === 'DOCUMENT' && t.source_id === documentId)
      .map(t => ({
        ...t,
        owner_name:users[t.owner_user_id] || '',
        effective_status:(t.due_date &&
          !['COMPLETED','CANCELLED'].includes(t.status) &&
          new Date(t.due_date) < new Date())
          ? 'OVERDUE'
          : t.status
      }));

    return {
      ok:true,
      document:doc,
      files:fileRows,
      history,
      tasks
    };
  }

  function create(payload) {
    AuthService.requirePermission('documents.create');
    const me = me_();
    payload = payload || {};

    const title = clean_(payload.title);
    if (!title) throw new Error('Trích yếu văn bản không được để trống.');

    const direction = normalizeDirection_(payload.direction);
    const no = clean_(payload.document_no);
    const dupe = duplicateNo_(no,direction,'');
    if (dupe) {
      throw new Error(
        `Số/ký hiệu "${no}" đã tồn tại ở văn bản "${dupe.title}".`
      );
    }

    const assignee = clean_(payload.assignee_user_id || me.userId);
    assertAssignee_(assignee);

    const now = new Date();
    const data = {
      document_id:uuid_(),
      direction,
      document_no:no,
      document_type:clean_(payload.document_type),
      title,
      summary:clean_(payload.summary),
      issuer:clean_(payload.issuer),
      issued_date:payload.issued_date || '',
      received_date:payload.received_date || now,
      field:clean_(payload.field),
      priority:normalizePriority_(payload.priority),
      status:normalizeStatus_(payload.status || 'NEW'),
      assignee_user_id:assignee,
      due_date:payload.due_date || '',
      drive_file_id:'',
      drive_folder_id:'',
      parent_document_id:clean_(payload.parent_document_id),
      notes:clean_(payload.notes),
      created_by:me.userId,
      created_at:now,
      updated_at:now
    };

    RepositoryService.append('DOCUMENTS',data);

    // P1: tạo thư mục Drive theo nhu cầu khi có file đính kèm.
    // Tránh một lần gọi Drive + một lần update Sheet cho văn bản chưa có file.
    addHistory_(data.document_id,'CREATE',{
      title:data.title,
      document_no:data.document_no,
      direction:data.direction,
      assignee_user_id:data.assignee_user_id,
      status:data.status
    });

    ActivityService.log('CREATE','DOCUMENT',data.document_id,{
      title:data.title,
      document_no:data.document_no,
      direction:data.direction
    });

    return enrich_(data,usersForResult_(me));
  }

  function update(documentId,payload) {
    AuthService.requirePermission('documents.update');
    payload = payload || {};

    const current = getDocument_(documentId);
    const direction = normalizeDirection_(payload.direction || current.direction);
    const no = clean_(
      payload.document_no !== undefined ? payload.document_no : current.document_no
    );

    const dupe = duplicateNo_(no,direction,documentId);
    if (dupe) {
      throw new Error(
        `Số/ký hiệu "${no}" đã tồn tại ở văn bản "${dupe.title}".`
      );
    }

    const assignee = clean_(
      payload.assignee_user_id !== undefined
        ? payload.assignee_user_id
        : current.assignee_user_id
    );
    assertAssignee_(assignee);

    const patch = {
      direction,
      document_no:no,
      document_type:clean_(
        payload.document_type !== undefined
          ? payload.document_type
          : current.document_type
      ),
      title:clean_(payload.title !== undefined ? payload.title : current.title),
      summary:clean_(
        payload.summary !== undefined ? payload.summary : current.summary
      ),
      issuer:clean_(payload.issuer !== undefined ? payload.issuer : current.issuer),
      issued_date:payload.issued_date !== undefined ? payload.issued_date : current.issued_date,
      received_date:payload.received_date !== undefined ? payload.received_date : current.received_date,
      field:clean_(payload.field !== undefined ? payload.field : current.field),
      priority:normalizePriority_(payload.priority || current.priority),
      assignee_user_id:assignee,
      due_date:payload.due_date !== undefined ? payload.due_date : current.due_date,
      notes:clean_(payload.notes !== undefined ? payload.notes : current.notes),
      updated_at:new Date()
    };

    if (!patch.title) throw new Error('Trích yếu văn bản không được để trống.');

    const updated = RepositoryService.updateById(
      'DOCUMENTS','document_id',documentId,patch
    );

    addHistory_(documentId,'UPDATE_INFO',{
      before:{
        title:current.title,
        document_no:current.document_no,
        direction:current.direction,
        assignee_user_id:current.assignee_user_id,
        due_date:current.due_date
      },
      after:{
        title:updated.title,
        document_no:updated.document_no,
        direction:updated.direction,
        assignee_user_id:updated.assignee_user_id,
        due_date:updated.due_date
      }
    });

    ActivityService.log('UPDATE','DOCUMENT',documentId,{
      title:updated.title,
      document_no:updated.document_no
    });

    return enrich_(updated,userMap_());
  }

  function updateProcessing(documentId,payload) {
    AuthService.requirePermission('documents.update');
    payload = payload || {};

    const current = getDocument_(documentId);
    const assignee = clean_(
      payload.assignee_user_id !== undefined
        ? payload.assignee_user_id
        : current.assignee_user_id
    );
    assertAssignee_(assignee);

    const status = normalizeStatus_(payload.status || current.status);
    const dueDate = payload.due_date !== undefined
      ? payload.due_date
      : current.due_date;

    const patch = {
      assignee_user_id:assignee,
      status,
      due_date:dueDate,
      updated_at:new Date()
    };

    const updated = RepositoryService.updateById(
      'DOCUMENTS','document_id',documentId,patch
    );

    addHistory_(documentId,'UPDATE_PROCESSING',{
      from_status:current.status,
      to_status:status,
      from_assignee:current.assignee_user_id,
      to_assignee:assignee,
      from_due_date:current.due_date,
      to_due_date:dueDate,
      note:clean_(payload.note)
    });

    ActivityService.log('UPDATE','DOCUMENT',documentId,{
      status,
      assignee_user_id:assignee,
      due_date:dueDate
    });

    return enrich_(updated,userMap_());
  }

  function addFile(documentId,file) {
    AuthService.requirePermission('documents.update');
    ensureSupportSheets_();

    if (!file || !file.base64 || !file.name) {
      throw new Error('Bạn chưa chọn tệp.');
    }

    const doc = getDocument_(documentId);
    const folderId = ensureDocumentFolder_(doc);
    const saved = DriveService.saveBase64FileToFolder(file,folderId);
    const me = me_();

    const row = {
      id:uuid_(),
      document_id:documentId,
      drive_file_id:saved.fileId,
      file_name:saved.name,
      mime_type:saved.mimeType,
      size:saved.size,
      uploaded_by:me.userId,
      created_at:new Date()
    };

    RepositoryService.append(FILE_SHEET,row);

    // Nếu là file đầu tiên, giữ tương thích với backend cũ.
    if (!doc.drive_file_id) {
      RepositoryService.updateById(
        'DOCUMENTS','document_id',documentId,{
          drive_file_id:saved.fileId,
          drive_folder_id:folderId,
          updated_at:new Date()
        }
      );
    }

    addHistory_(documentId,'ADD_FILE',{
      file_name:saved.name,
      drive_file_id:saved.fileId,
      size:saved.size
    });

    ActivityService.log('UPLOAD_FILE','DOCUMENT',documentId,{
      fileName:saved.name,
      driveFileId:saved.fileId
    });

    return serializeFile_(row);
  }

  function addNote(documentId,note) {
    AuthService.requirePermission('documents.update');

    const text = clean_(note);
    if (!text) throw new Error('Nội dung ghi chú đang trống.');

    getDocument_(documentId);

    addHistory_(documentId,'NOTE',{note:text});
    ActivityService.log('UPDATE','DOCUMENT',documentId,{note:text});

    return {ok:true};
  }

  function archive(documentId,note) {
    AuthService.requirePermission('documents.update');

    const current = getDocument_(documentId);
    if (current.status === 'ARCHIVED') {
      return enrich_(current,userMap_());
    }

    const updated = RepositoryService.updateById(
      'DOCUMENTS','document_id',documentId,{
        status:'ARCHIVED',
        updated_at:new Date()
      }
    );

    addHistory_(documentId,'ARCHIVE',{
      from_status:current.status,
      note:clean_(note)
    });

    ActivityService.log('UPDATE','DOCUMENT',documentId,{
      status:'ARCHIVED'
    });

    return enrich_(updated,userMap_());
  }

  function createTask(documentId,payload) {
    AuthService.requirePermission('tasks.create');

    const doc = getDocument_(documentId);
    payload = payload || {};

    const task = TaskService.create({
      title:clean_(payload.title) || ('Xử lý văn bản ' + (doc.document_no || '')),
      description:clean_(payload.description) ||
        `${doc.title || ''}\n${doc.summary || ''}`.trim(),
      source_type:'DOCUMENT',
      source_id:documentId,
      priority:payload.priority || doc.priority || 'NORMAL',
      owner_user_id:payload.owner_user_id || doc.assignee_user_id || '',
      collaborator_ids:payload.collaborator_ids || '',
      due_date:payload.due_date || doc.due_date || ''
    });

    addHistory_(documentId,'CREATE_TASK',{
      task_id:task.task_id,
      title:task.title
    });

    return task;
  }

  return {
    list,
    get,
    create,
    update,
    updateProcessing,
    addFile,
    addNote,
    archive,
    createTask
  };
})();