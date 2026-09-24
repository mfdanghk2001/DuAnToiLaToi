const D2TaskService = (() => {
  const FILE_SHEET = 'TASK_FILES';
  const SUPPORT_READY_KEY = 'VPDU_D2_SUPPORT_READY_V1';
  let supportReadyRuntime = false;

  const FILE_HEADERS = [
    'task_file_id','task_id','drive_file_id','file_name','mime_type',
    'size','uploaded_by','created_at'
  ];

  const VALID_PRIORITIES = ['NORMAL','HIGH','URGENT'];
  const VALID_STATUSES = [
    'NEW','IN_PROGRESS','WAITING_APPROVAL','COMPLETED','CANCELLED'
  ];

  function clean_(v) {
    return String(v == null ? '' : v).trim();
  }

  function currentUser_() {
    const user = AuthService.getCurrentUser();
    if (!user.authenticated) throw new Error('Chưa đăng nhập.');
    return user;
  }

  function ensureSupportSheet_() {
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
      sh.getRange(1,1,1,FILE_HEADERS.length).setValues([FILE_HEADERS]);
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,FILE_HEADERS.length)
        .setFontWeight('bold')
        .setBackground('#991B1B')
        .setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');
      sh.setRowHeight(1,34);
      sh.autoResizeColumns(1,FILE_HEADERS.length);
    }

    supportReadyRuntime = true;
    try { cache.put(SUPPORT_READY_KEY,'1',21600); } catch (e) {}
  }

  function getTask_(taskId) {
    const task = RepositoryService.findById('TASKS','task_id',taskId);
    if (!task) throw new Error('Không tìm thấy nhiệm vụ.');
    return task;
  }

  function userMap_() {
    const map = {};
    AuthService.listUsersCached().forEach(u => {
      map[u.user_id] = {
        user_id:u.user_id,
        full_name:u.full_name || u.email || u.user_id,
        email:u.email || '',
        department_id:u.department_id || '',
        role:u.role || '',
        status:u.status || ''
      };
    });
    return map;
  }

  function collaboratorIds_(task) {
    if (Array.isArray(task.collaborator_ids)) return task.collaborator_ids.filter(Boolean);
    return clean_(task.collaborator_ids)
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
  }

  function activeUser_(userId) {
    if (!userId) return null;
    const u = AuthService.listUsersCached().find(x => x.user_id === userId);
    if (!u || u.status !== 'ACTIVE') return null;
    return u;
  }

  function validateUsers_(ownerId, collaboratorIds) {
    if (!activeUser_(ownerId)) {
      throw new Error('Người chủ trì không tồn tại hoặc đã ngừng hoạt động.');
    }
    collaboratorIds.forEach(id => {
      if (!activeUser_(id)) {
        throw new Error('Có người phối hợp không tồn tại hoặc đã ngừng hoạt động.');
      }
    });
  }

  function normalizePriority_(v) {
    const p = clean_(v || 'NORMAL').toUpperCase();
    if (!VALID_PRIORITIES.includes(p)) throw new Error('Mức độ ưu tiên không hợp lệ.');
    return p;
  }

  function normalizeStatus_(v) {
    const s = clean_(v || 'NEW').toUpperCase();
    if (!VALID_STATUSES.includes(s)) throw new Error('Trạng thái nhiệm vụ không hợp lệ.');
    return s;
  }

  function effectiveStatus_(task) {
    if (
      task.due_date &&
      !['COMPLETED','CANCELLED'].includes(task.status)
    ) {
      const due = new Date(task.due_date);
      if (!isNaN(due) && due < new Date()) return 'OVERDUE';
    }
    return task.status || 'NEW';
  }

  function sourceTitleForTask_(task) {
    if (!task.source_id) return '';

    if (task.source_type === 'DOCUMENT') {
      const x = RepositoryService.findById('DOCUMENTS','document_id',task.source_id);
      return x ? [x.document_no,x.title].filter(Boolean).join(' · ') : 'Văn bản';
    }

    if (task.source_type === 'MEETING') {
      const x = RepositoryService.findById('MEETINGS','meeting_id',task.source_id);
      return x?.title || 'Cuộc họp';
    }

    if (task.source_type === 'DRAFT') {
      const x = RepositoryService.findById('DRAFTS','draft_id',task.source_id);
      return x?.title || 'Bản nháp';
    }

    return '';
  }

  function sourceUrl_(task) {
    if (!task.source_id) return '';
    if (task.source_type === 'DOCUMENT') return 'DOCUMENT:' + task.source_id;
    if (task.source_type === 'MEETING') return 'MEETING:' + task.source_id;
    if (task.source_type === 'DRAFT') return 'DRAFT:' + task.source_id;
    return '';
  }

  function permissionFlags_(task) {
    const me = currentUser_();
    const perms = me.permissions || [];
    const has = permission => perms.includes('*') || perms.includes(permission);
    const collaborators = collaboratorIds_(task);
    const fullUpdate = has('tasks.update');
    const ownUpdate =
      has('tasks.update_own') &&
      (task.owner_user_id === me.userId || collaborators.includes(me.userId));

    return {
      canEdit:fullUpdate,
      canContribute:fullUpdate || ownUpdate,
      canApprove:has('tasks.approve'),
      canCancel:fullUpdate,
      canCreate:has('tasks.create')
    };
  }

  function requireContribute_(task) {
    const p = permissionFlags_(task);
    if (!p.canContribute) {
      throw new Error('Bạn không có quyền cập nhật nhiệm vụ này.');
    }
    return p;
  }

  function requireFullUpdate_() {
    AuthService.requirePermission('tasks.update');
  }

  function addHistory_(taskId, action, detail) {
    const me = currentUser_();
    detail = detail || {};
    RepositoryService.append('TASK_HISTORY',{
      history_id:uuid_(),
      task_id:taskId,
      action:action,
      from_status:detail.from_status || '',
      to_status:detail.to_status || '',
      from_progress:detail.from_progress === undefined ? '' : detail.from_progress,
      to_progress:detail.to_progress === undefined ? '' : detail.to_progress,
      note:clean_(detail.note),
      actor_user_id:me.userId,
      created_at:new Date()
    });
  }

  function enrich_(task, users, sourceTitle, fileCount, commentCount) {
    const collabIds = collaboratorIds_(task);
    return {
      ...task,
      progress:Number(task.progress || 0),
      effective_status:effectiveStatus_(task),
      owner_name:users[task.owner_user_id]?.full_name || '',
      assigner_name:users[task.assigner_user_id]?.full_name || '',
      collaborator_ids:collabIds,
      collaborator_names:collabIds.map(id => users[id]?.full_name || id),
      source_title:sourceTitle || '',
      source_ref:sourceUrl_(task),
      file_count:Number(fileCount || 0),
      comment_count:Number(commentCount || 0)
    };
  }

  function list(filters) {
    AuthService.requirePermission('tasks.view');

    filters = filters || {};
    const q = clean_(filters.q).toLowerCase();
    const status = clean_(filters.status || 'ALL').toUpperCase();
    const owner = clean_(filters.owner || 'ALL');
    const priority = clean_(filters.priority || 'ALL').toUpperCase();
    const sourceType = clean_(filters.sourceType || 'ALL').toUpperCase();
    const due = clean_(filters.due || 'ALL').toUpperCase();
    const page = Math.max(1,Number(filters.page || 1));
    const pageSize = Math.max(5,Math.min(Number(filters.pageSize || 10),50));

    const started = Date.now();
    const users = userMap_();

    // P1: danh sách nhiệm vụ chỉ cần TASKS + user cache.
    // File, lịch sử và hồ sơ nguồn chỉ đọc khi mở chi tiết.
    let all = RepositoryService.getAll('TASKS')
      .map(t => enrich_(t,users,'',0,0));

    const now = new Date();
    const next48 = new Date(now.getTime() + 48*60*60*1000);

    const stats = {
      total:all.length,
      newCount:all.filter(t => t.status === 'NEW').length,
      inProgress:all.filter(t => t.status === 'IN_PROGRESS').length,
      waitingApproval:all.filter(t => t.status === 'WAITING_APPROVAL').length,
      completed:all.filter(t => t.status === 'COMPLETED').length,
      cancelled:all.filter(t => t.status === 'CANCELLED').length,
      overdue:all.filter(t => t.effective_status === 'OVERDUE').length,
      dueSoon:all.filter(t => {
        if (!t.due_date || ['COMPLETED','CANCELLED'].includes(t.status)) return false;
        const d = new Date(t.due_date);
        return !isNaN(d) && d >= now && d <= next48;
      }).length
    };

    if (status !== 'ALL') {
      if (status === 'OVERDUE') all = all.filter(t => t.effective_status === 'OVERDUE');
      else all = all.filter(t => t.status === status);
    }

    if (owner !== 'ALL') {
      all = all.filter(t =>
        t.owner_user_id === owner ||
        (t.collaborator_ids || []).includes(owner)
      );
    }

    if (priority !== 'ALL') all = all.filter(t => t.priority === priority);
    if (sourceType !== 'ALL') all = all.filter(t => (t.source_type || '') === sourceType);

    if (due === 'DUE_SOON') {
      all = all.filter(t => {
        if (!t.due_date || ['COMPLETED','CANCELLED'].includes(t.status)) return false;
        const d = new Date(t.due_date);
        return !isNaN(d) && d >= now && d <= next48;
      });
    } else if (due === 'OVERDUE') {
      all = all.filter(t => t.effective_status === 'OVERDUE');
    } else if (due === 'NO_DUE') {
      all = all.filter(t => !t.due_date);
    }

    if (q) {
      all = all.filter(t =>
        [
          t.title,t.description,t.owner_name,t.assigner_name,
          (t.collaborator_names || []).join(' '),
          t.result_note,taskSourceLabelForSearch_(t.source_type)
        ].some(v => String(v || '').toLowerCase().includes(q))
      );
    }

    all.sort((a,b) => {
      const aDone = ['COMPLETED','CANCELLED'].includes(a.status) ? 1 : 0;
      const bDone = ['COMPLETED','CANCELLED'].includes(b.status) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;

      const ad = a.due_date ? new Date(a.due_date) : null;
      const bd = b.due_date ? new Date(b.due_date) : null;
      if (ad && bd && !isNaN(ad) && !isNaN(bd)) return ad - bd;
      if (ad && !isNaN(ad)) return -1;
      if (bd && !isNaN(bd)) return 1;
      return String(b.updated_at || b.created_at || '')
        .localeCompare(String(a.updated_at || a.created_at || ''));
    });

    const total = all.length;
    const pages = Math.max(1,Math.ceil(total/pageSize));
    const safePage = Math.min(page,pages);
    const start = (safePage-1)*pageSize;

    return {
      ok:true,
      items:all.slice(start,start+pageSize),
      kanban:all.slice(0,filters.warm ? 80 : 300),
      stats,
      pagination:{
        page:safePage,
        pageSize,
        total,
        pages,
        from:total ? start+1 : 0,
        to:Math.min(start+pageSize,total)
      },
      options:{
        users:Object.values(users)
          .filter(u => u.status === 'ACTIVE')
          .map(u => ({
            user_id:u.user_id,
            full_name:u.full_name,
            role:u.role,
            department_id:u.department_id
          }))
          .sort((a,b) => a.full_name.localeCompare(b.full_name,'vi'))
      },
      server_ms:Date.now()-started
    };
  }

  function taskSourceLabelForSearch_(type) {
    return ({
      DOCUMENT:'văn bản',
      MEETING:'cuộc họp',
      DRAFT:'bản nháp'
    })[type] || '';
  }

  function listHistory_(taskId, users) {
    return RepositoryService.getAll('TASK_HISTORY')
      .filter(h => h.task_id === taskId)
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(h => ({
        ...h,
        actor_name:users[h.actor_user_id]?.full_name || 'Hệ thống'
      }));
  }

  function listFiles_(taskId, users) {
    ensureSupportSheet_();
    return RepositoryService.getAll(FILE_SHEET)
      .filter(f => f.task_id === taskId)
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(f => ({
        ...f,
        size:Number(f.size || 0),
        uploader_name:users[f.uploaded_by]?.full_name || '',
        url:f.drive_file_id
          ? ('https://drive.google.com/open?id=' + f.drive_file_id)
          : ''
      }));
  }

  function get(taskId) {
    AuthService.requirePermission('tasks.view');
    ensureSupportSheet_();

    const started = Date.now();
    const users = userMap_();
    const task = getTask_(taskId);
    const fileRows = listFiles_(taskId,users);
    const history = listHistory_(taskId,users);
    const sourceTitle = sourceTitleForTask_(task);

    return {
      ok:true,
      task:enrich_(
        task,
        users,
        sourceTitle,
        fileRows.length,
        history.filter(h => h.action === 'COMMENT').length
      ),
      files:fileRows,
      history,
      permissions:permissionFlags_(task),
      server_ms:Date.now()-started
    };
  }

  function create(payload) {
    AuthService.requirePermission('tasks.create');
    payload = payload || {};

    const title = clean_(payload.title);
    if (!title) throw new Error('Tên nhiệm vụ không được để trống.');

    const me = currentUser_();
    const ownerId = clean_(payload.owner_user_id || me.userId);
    const collaboratorIds = Array.isArray(payload.collaborator_ids)
      ? payload.collaborator_ids.map(clean_).filter(Boolean)
      : clean_(payload.collaborator_ids).split(',').map(clean_).filter(Boolean);

    const uniqueCollaborators = [...new Set(collaboratorIds)]
      .filter(id => id !== ownerId);

    validateUsers_(ownerId,uniqueCollaborators);

    const task = TaskService.create({
      title,
      description:clean_(payload.description),
      source_type:clean_(payload.source_type).toUpperCase(),
      source_id:clean_(payload.source_id),
      priority:normalizePriority_(payload.priority),
      owner_user_id:ownerId,
      collaborator_ids:uniqueCollaborators,
      start_date:payload.start_date || new Date(),
      due_date:payload.due_date || '',
      conclusion_item_no:clean_(payload.conclusion_item_no)
    });

    addHistory_(task.task_id,'CREATE',{
      from_status:'',
      to_status:'NEW',
      from_progress:'',
      to_progress:0,
      note:'Tạo nhiệm vụ'
    });

    return {
      ok:true,
      task:{
        task_id:task.task_id,
        status:task.status || 'NEW',
        progress:Number(task.progress || 0)
      }
    };
  }

  function update(taskId,payload) {
    requireFullUpdate_();
    payload = payload || {};

    const current = getTask_(taskId);
    const title = clean_(payload.title !== undefined ? payload.title : current.title);
    if (!title) throw new Error('Tên nhiệm vụ không được để trống.');

    const ownerId = clean_(
      payload.owner_user_id !== undefined
        ? payload.owner_user_id
        : current.owner_user_id
    );

    const collaboratorIds = payload.collaborator_ids !== undefined
      ? (Array.isArray(payload.collaborator_ids)
          ? payload.collaborator_ids.map(clean_).filter(Boolean)
          : clean_(payload.collaborator_ids).split(',').map(clean_).filter(Boolean))
      : collaboratorIds_(current);

    const uniqueCollaborators = [...new Set(collaboratorIds)]
      .filter(id => id !== ownerId);

    validateUsers_(ownerId,uniqueCollaborators);

    const patch = {
      title,
      description:clean_(
        payload.description !== undefined ? payload.description : current.description
      ),
      priority:normalizePriority_(
        payload.priority !== undefined ? payload.priority : current.priority
      ),
      owner_user_id:ownerId,
      collaborator_ids:uniqueCollaborators.join(','),
      start_date:payload.start_date !== undefined ? payload.start_date : current.start_date,
      due_date:payload.due_date !== undefined ? payload.due_date : current.due_date,
      updated_at:new Date()
    };

    const updated = RepositoryService.updateById(
      'TASKS','task_id',taskId,patch
    );

    addHistory_(taskId,'EDIT',{
      from_status:current.status,
      to_status:updated.status,
      from_progress:current.progress,
      to_progress:updated.progress,
      note:clean_(payload.note || 'Cập nhật thông tin nhiệm vụ')
    });

    ActivityService.log('UPDATE','TASK',taskId,{
      title:updated.title,
      owner_user_id:updated.owner_user_id,
      collaborator_ids:updated.collaborator_ids,
      due_date:updated.due_date
    });

    return {
      ok:true,
      task:{
        task_id:taskId,
        status:updated.status,
        progress:Number(updated.progress || 0)
      }
    };
  }

  function updateProgress(taskId,payload) {
    const current = getTask_(taskId);
    requireContribute_(current);
    payload = payload || {};

    if (['COMPLETED','CANCELLED'].includes(current.status)) {
      throw new Error('Nhiệm vụ đã kết thúc. Hãy mở lại trước khi cập nhật tiến độ.');
    }

    const fromProgress = Number(current.progress || 0);
    let progress = payload.progress === undefined
      ? fromProgress
      : Math.max(0,Math.min(100,Number(payload.progress || 0)));

    let status = payload.status
      ? normalizeStatus_(payload.status)
      : current.status;

    if (status === 'COMPLETED') {
      throw new Error('Nhiệm vụ phải được người có quyền duyệt hoàn thành.');
    }

    if (status === 'CANCELLED') {
      throw new Error('Chỉ người quản lý nhiệm vụ mới có thể hủy.');
    }

    if (status === 'WAITING_APPROVAL') {
      throw new Error('Hãy dùng chức năng Trình duyệt để chuyển nhiệm vụ sang Chờ duyệt.');
    }
    if (status === 'NEW' && progress > 0) status = 'IN_PROGRESS';
    if (status === 'IN_PROGRESS' && progress >= 100) status = 'WAITING_APPROVAL';

    const patch = {
      progress,
      status,
      result_note:payload.result_note !== undefined
        ? clean_(payload.result_note)
        : current.result_note,
      updated_at:new Date()
    };

    const updated = RepositoryService.updateById(
      'TASKS','task_id',taskId,patch
    );

    addHistory_(taskId,'UPDATE_PROGRESS',{
      from_status:current.status,
      to_status:updated.status,
      from_progress:fromProgress,
      to_progress:updated.progress,
      note:clean_(payload.note)
    });

    ActivityService.log('UPDATE_PROGRESS','TASK',taskId,{
      progress:updated.progress,
      status:updated.status
    });

    return {ok:true, task_id:taskId};
  }

  function submitForApproval(taskId,note) {
    const current = getTask_(taskId);
    requireContribute_(current);

    if (['COMPLETED','CANCELLED'].includes(current.status)) {
      throw new Error('Nhiệm vụ đã kết thúc.');
    }

    const updated = RepositoryService.updateById(
      'TASKS','task_id',taskId,{
        progress:100,
        status:'WAITING_APPROVAL',
        updated_at:new Date()
      }
    );

    addHistory_(taskId,'SUBMIT_APPROVAL',{
      from_status:current.status,
      to_status:'WAITING_APPROVAL',
      from_progress:current.progress,
      to_progress:100,
      note:clean_(note || 'Trình duyệt hoàn thành')
    });

    ActivityService.log('SUBMIT_APPROVAL','TASK',taskId,{});

    return {ok:true, task_id:taskId};
  }

  function approve(taskId,action,note) {
    AuthService.requirePermission('tasks.approve');
    const current = getTask_(taskId);

    action = clean_(action || 'APPROVE').toUpperCase();
    if (!['APPROVE','RETURN'].includes(action)) {
      throw new Error('Hành động duyệt không hợp lệ.');
    }

    if (current.status !== 'WAITING_APPROVAL') {
      throw new Error('Nhiệm vụ chưa ở trạng thái chờ duyệt.');
    }

    if (action === 'APPROVE') {
      RepositoryService.updateById(
        'TASKS','task_id',taskId,{
          progress:100,
          status:'COMPLETED',
          completed_at:new Date(),
          result_note:current.result_note,
          updated_at:new Date()
        }
      );

      addHistory_(taskId,'APPROVE',{
        from_status:current.status,
        to_status:'COMPLETED',
        from_progress:current.progress,
        to_progress:100,
        note:clean_(note || 'Đã duyệt hoàn thành')
      });

      ActivityService.log('APPROVE','TASK',taskId,{});
    } else {
      RepositoryService.updateById(
        'TASKS','task_id',taskId,{
          progress:Math.min(99,Number(current.progress || 0)),
          status:'IN_PROGRESS',
          completed_at:'',
          updated_at:new Date()
        }
      );

      addHistory_(taskId,'RETURN',{
        from_status:current.status,
        to_status:'IN_PROGRESS',
        from_progress:current.progress,
        to_progress:Math.min(99,Number(current.progress || 0)),
        note:clean_(note || 'Trả lại để bổ sung')
      });

      ActivityService.log('RETURN','TASK',taskId,{note:clean_(note)});
    }

    return {ok:true, task_id:taskId};
  }

  function cancel(taskId,note) {
    requireFullUpdate_();
    const current = getTask_(taskId);
    if (current.status === 'COMPLETED') {
      throw new Error('Không thể hủy nhiệm vụ đã được duyệt hoàn thành.');
    }

    RepositoryService.updateById(
      'TASKS','task_id',taskId,{
        status:'CANCELLED',
        updated_at:new Date()
      }
    );

    addHistory_(taskId,'CANCEL',{
      from_status:current.status,
      to_status:'CANCELLED',
      from_progress:current.progress,
      to_progress:current.progress,
      note:clean_(note || 'Hủy nhiệm vụ')
    });

    ActivityService.log('CANCEL','TASK',taskId,{note:clean_(note)});
    return {ok:true, task_id:taskId};
  }

  function reopen(taskId,note) {
    requireFullUpdate_();
    const current = getTask_(taskId);

    if (!['COMPLETED','CANCELLED'].includes(current.status)) {
      throw new Error('Nhiệm vụ chưa kết thúc nên không cần mở lại.');
    }

    const progress = current.status === 'COMPLETED'
      ? Math.min(90,Number(current.progress || 0))
      : Number(current.progress || 0);

    RepositoryService.updateById(
      'TASKS','task_id',taskId,{
        status:'IN_PROGRESS',
        progress,
        completed_at:'',
        updated_at:new Date()
      }
    );

    addHistory_(taskId,'REOPEN',{
      from_status:current.status,
      to_status:'IN_PROGRESS',
      from_progress:current.progress,
      to_progress:progress,
      note:clean_(note || 'Mở lại nhiệm vụ')
    });

    ActivityService.log('REOPEN','TASK',taskId,{});
    return {ok:true, task_id:taskId};
  }

  function addComment(taskId,note) {
    const current = getTask_(taskId);
    const permissions = permissionFlags_(current);

    if (!permissions.canContribute && !permissions.canApprove) {
      throw new Error('Bạn không có quyền ghi chú vào nhiệm vụ này.');
    }

    const text = clean_(note);
    if (!text) throw new Error('Nội dung ghi chú đang trống.');

    addHistory_(taskId,'COMMENT',{
      from_status:current.status,
      to_status:current.status,
      from_progress:current.progress,
      to_progress:current.progress,
      note:text
    });

    ActivityService.log('COMMENT','TASK',taskId,{note:text});
    return {ok:true, task_id:taskId};
  }

  function ensureTaskFolder_(taskId,taskTitle) {
    const rootId = DriveService.getFolderIdByKey('ATTACHMENTS');
    const root = DriveApp.getFolderById(rootId);
    const folderName = 'TASK_' + taskId;
    const it = root.getFoldersByName(folderName);
    if (it.hasNext()) return it.next();

    const folder = root.createFolder(folderName);
    try {
      folder.setDescription('Nhiệm vụ: ' + clean_(taskTitle));
    } catch (e) {}
    return folder;
  }

  function addFile(taskId,file) {
    ensureSupportSheet_();
    const task = getTask_(taskId);
    requireContribute_(task);

    if (!file || !file.name || !file.base64) {
      throw new Error('Bạn chưa chọn tệp.');
    }

    if (file.size && Number(file.size) > 20*1024*1024) {
      throw new Error('Mỗi tệp đính kèm tối đa 20 MB.');
    }

    const folder = ensureTaskFolder_(taskId,task.title);
    const saved = DriveService.saveBase64FileToFolder(file,folder.getId());
    const me = currentUser_();

    const row = {
      task_file_id:uuid_(),
      task_id:taskId,
      drive_file_id:saved.fileId,
      file_name:saved.name,
      mime_type:saved.mimeType,
      size:saved.size,
      uploaded_by:me.userId,
      created_at:new Date()
    };

    RepositoryService.append(FILE_SHEET,row);

    addHistory_(taskId,'ADD_FILE',{
      from_status:task.status,
      to_status:task.status,
      from_progress:task.progress,
      to_progress:task.progress,
      note:'Thêm tệp: ' + saved.name
    });

    ActivityService.log('UPLOAD_FILE','TASK',taskId,{
      fileName:saved.name,
      driveFileId:saved.fileId
    });

    return {ok:true, task_id:taskId};
  }

  return {
    list,
    get,
    create,
    update,
    updateProgress,
    submitForApproval,
    approve,
    cancel,
    reopen,
    addComment,
    addFile
  };
})();