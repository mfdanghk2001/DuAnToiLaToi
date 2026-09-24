const ActivityService = (() => {
  function log(action, entityType, entityId, detail) {
    let user = {userId:''};
    try { user = AuthService.getCurrentUser(); } catch (e) {}

    RepositoryService.append('ACTIVITY_LOG', {
      log_id: uuid_(),
      user_id: user.userId || '',
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail_json: JSON.stringify(detail || {}),
      ip_note: '',
      created_at: new Date()
    });
  }
  return {log};
})();

const UserService = (() => {
  function listActive() {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated) throw new Error('Chưa đăng nhập.');
    return AuthService.listActiveUsersCached()
      .map(x => ({
        user_id:x.user_id,
        email:x.email,
        full_name:x.full_name,
        department_id:x.department_id,
        role:x.role
      }));
  }

  function nameMap() {
    const map = {};
    listActive().forEach(u => map[u.user_id] = u.full_name || u.email);
    return map;
  }
  return {listActive, nameMap};
})();

const DocumentService = (() => {
  function list() {
    AuthService.requirePermission('documents.view');
    const users = UserService.nameMap();
    return RepositoryService.getAll('DOCUMENTS')
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(d => ({
        ...d,
        assignee_name: users[d.assignee_user_id] || '',
        file_url: d.drive_file_id ? ('https://drive.google.com/open?id=' + d.drive_file_id) : ''
      }));
  }

  function create(payload) {
    AuthService.requirePermission('documents.create');
    if (!payload || !String(payload.title || '').trim()) throw new Error('Trích yếu văn bản không được để trống.');

    const user = AuthService.getCurrentUser();
    const now = new Date();
    let file = null;

    if (payload.attachment && payload.attachment.base64) {
      const folderKey = payload.direction === 'OUTGOING' ? 'OUTGOING' :
                        payload.direction === 'DRAFT' ? 'DRAFTS' : 'INCOMING';
      file = DriveService.saveBase64File(payload.attachment, folderKey);
    }

    const data = {
      document_id: uuid_(),
      direction: payload.direction || 'INCOMING',
      document_no: String(payload.document_no || '').trim(),
      document_type: payload.document_type || '',
      title: String(payload.title || '').trim(),
      summary: String(payload.summary || ''),
      issuer: String(payload.issuer || ''),
      issued_date: payload.issued_date || '',
      received_date: payload.received_date || now,
      field: payload.field || '',
      priority: payload.priority || 'NORMAL',
      status: payload.status || 'NEW',
      assignee_user_id: payload.assignee_user_id || user.userId,
      due_date: payload.due_date || '',
      drive_file_id: file ? file.fileId : '',
      drive_folder_id: file ? file.folderId : '',
      parent_document_id: payload.parent_document_id || '',
      notes: String(payload.notes || ''),
      created_by: user.userId,
      created_at: now,
      updated_at: now
    };

    RepositoryService.append('DOCUMENTS', data);
    ActivityService.log('CREATE','DOCUMENT',data.document_id,{title:data.title, fileId:data.drive_file_id});
    return {...data, assignee_name:user.fullName, file_url:file ? file.url : ''};
  }

  return {list, create};
})();

const TaskService = (() => {
  function list() {
    AuthService.requirePermission('tasks.view');
    const users = UserService.nameMap();
    const now = new Date();

    return RepositoryService.getAll('TASKS')
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(t => {
        let effectiveStatus = t.status;
        if (t.due_date && !['COMPLETED','CANCELLED'].includes(t.status)) {
          const due = new Date(t.due_date);
          if (!isNaN(due) && due < now) effectiveStatus = 'OVERDUE';
        }
        return {
          ...t,
          effective_status: effectiveStatus,
          owner_name: users[t.owner_user_id] || '',
          assigner_name: users[t.assigner_user_id] || ''
        };
      });
  }

  function create(payload) {
    AuthService.requirePermission('tasks.create');
    if (!payload || !String(payload.title || '').trim()) {
      throw new Error('Tên nhiệm vụ không được để trống.');
    }

    const user = AuthService.getCurrentUser();
    const now = new Date();

    const data = {
      task_id: uuid_(),
      title: String(payload.title || '').trim(),
      description: String(payload.description || ''),
      source_type: payload.source_type || '',
      source_id: payload.source_id || '',
      priority: payload.priority || 'NORMAL',
      status: 'NEW',
      progress: 0,
      assigner_user_id: user.userId,
      owner_user_id: payload.owner_user_id || user.userId,
      collaborator_ids: Array.isArray(payload.collaborator_ids)
        ? payload.collaborator_ids.join(',')
        : (payload.collaborator_ids || ''),
      start_date: payload.start_date || now,
      due_date: payload.due_date || '',
      completed_at: '',
      result_note: '',
      created_at: now,
      updated_at: now
    };

    RepositoryService.append('TASKS', data);

    if (data.source_type === 'MEETING' && data.source_id) {
      RepositoryService.append('MEETING_TASKS', {
        id: uuid_(),
        meeting_id: data.source_id,
        task_id: data.task_id,
        conclusion_item_no: payload.conclusion_item_no || '',
        created_at: now
      });
    }

    ActivityService.log('CREATE','TASK',data.task_id,{
      title:data.title,
      source_type:data.source_type,
      source_id:data.source_id
    });

    return {
      ...data,
      owner_name: user.fullName,
      effective_status: 'NEW'
    };
  }

  function updateProgress(taskId, progress, status, note) {
    AuthService.requirePermission('tasks.update');
    const now = new Date();
    const value = Math.max(0, Math.min(100, Number(progress || 0)));

    const patch = {
      progress: value,
      updated_at: now
    };

    if (status) patch.status = status;
    if (note !== undefined) patch.result_note = note;

    if (status === 'COMPLETED') {
      patch.completed_at = now;
      patch.progress = 100;
    }

    const updated = RepositoryService.updateById(
      'TASKS','task_id',taskId,patch
    );

    if (!updated) throw new Error('Không tìm thấy nhiệm vụ.');

    ActivityService.log('UPDATE_PROGRESS','TASK',taskId,{
      progress:patch.progress,
      status:patch.status || ''
    });

    return updated;
  }

  return {list, create, updateProgress};
})();

const CalendarService = (() => {
  function list() {
    AuthService.requirePermission('calendar.view');

    return RepositoryService.getAll('CALENDAR')
      .sort((a,b) => {
        const aa = `${a.event_date || ''}T${a.start_time || '00:00'}`;
        const bb = `${b.event_date || ''}T${b.start_time || '00:00'}`;
        return aa.localeCompare(bb);
      });
  }

  function create(payload) {
    AuthService.requirePermission('calendar.create');

    if (!payload || !String(payload.title || '').trim()) {
      throw new Error('Tên lịch công tác không được để trống.');
    }
    if (!payload.event_date) {
      throw new Error('Bạn chưa chọn ngày.');
    }

    const user = AuthService.getCurrentUser();
    const now = new Date();

    const data = {
      event_id: uuid_(),
      title: String(payload.title || '').trim(),
      event_type: payload.event_type || 'WORK',
      calendar_group: payload.calendar_group || 'GENERAL',
      event_date: payload.event_date,
      start_time: payload.start_time || '',
      end_time: payload.end_time || '',
      location: String(payload.location || ''),
      description: String(payload.description || ''),
      meeting_id: payload.meeting_id || '',
      task_id: payload.task_id || '',
      created_by: user.userId,
      created_at: now,
      updated_at: now
    };

    RepositoryService.append('CALENDAR', data);
    ActivityService.log('CREATE','CALENDAR',data.event_id,{
      title:data.title,
      event_date:data.event_date
    });

    return data;
  }

  return {list, create};
})();

const MeetingService = (() => {
  function list() {
    AuthService.requirePermission('meetings.view');

    const tasks = TaskService.list();
    const linkedRows = RepositoryService.getAll('MEETING_TASKS');

    return RepositoryService.getAll('MEETINGS')
      .sort((a,b) => {
        const aa = `${a.meeting_date || ''}T${a.start_time || '00:00'}`;
        const bb = `${b.meeting_date || ''}T${b.start_time || '00:00'}`;
        return aa.localeCompare(bb);
      })
      .map(m => {
        const taskIds = linkedRows
          .filter(x => x.meeting_id === m.meeting_id)
          .map(x => x.task_id);

        return {
          ...m,
          linked_tasks: tasks.filter(t =>
            taskIds.includes(t.task_id) ||
            (t.source_type === 'MEETING' && t.source_id === m.meeting_id)
          ),
          folder_url: m.drive_folder_id
            ? ('https://drive.google.com/drive/folders/' + m.drive_folder_id)
            : '',
          minutes_url: m.minutes_file_id
            ? ('https://drive.google.com/open?id=' + m.minutes_file_id)
            : '',
          conclusion_url: m.conclusion_file_id
            ? ('https://drive.google.com/open?id=' + m.conclusion_file_id)
            : ''
        };
      });
  }

  function create(payload) {
    AuthService.requirePermission('meetings.create');

    if (!payload || !String(payload.title || '').trim()) {
      throw new Error('Tên cuộc họp không được để trống.');
    }
    if (!payload.meeting_date) {
      throw new Error('Bạn chưa chọn ngày họp.');
    }

    const user = AuthService.getCurrentUser();
    const now = new Date();
    const meetingId = uuid_();

    const folder = DriveService.createMeetingFolder(
      meetingId,
      payload.title,
      payload.meeting_date
    );

    let material = null;
    if (payload.attachment && payload.attachment.base64) {
      material = DriveService.saveBase64FileToFolder(
        payload.attachment,
        folder.folderId
      );
    }

    const data = {
      meeting_id: meetingId,
      meeting_type: payload.meeting_type || 'Khác',
      title: String(payload.title || '').trim(),
      agenda: String(payload.agenda || ''),
      meeting_date: payload.meeting_date,
      start_time: payload.start_time || '',
      end_time: payload.end_time || '',
      location: String(payload.location || ''),
      chairperson: String(payload.chairperson || ''),
      status: payload.status || 'PLANNED',
      minutes_file_id: material ? material.fileId : '',
      conclusion_file_id: '',
      drive_folder_id: folder.folderId,
      created_by: user.userId,
      created_at: now,
      updated_at: now
    };

    RepositoryService.append('MEETINGS', data);

    // Tự động thêm vào lịch công tác.
    CalendarService.create({
      title: data.title,
      event_type: 'MEETING',
      calendar_group: 'GENERAL',
      event_date: data.meeting_date,
      start_time: data.start_time,
      end_time: data.end_time,
      location: data.location,
      description: data.agenda,
      meeting_id: data.meeting_id
    });

    ActivityService.log('CREATE','MEETING',data.meeting_id,{
      title:data.title,
      meeting_date:data.meeting_date
    });

    return {
      ...data,
      linked_tasks: [],
      folder_url: folder.url,
      minutes_url: material ? material.url : '',
      conclusion_url: ''
    };
  }

  function updateAgenda(meetingId, agenda) {
    AuthService.requirePermission('meetings.update');

    const updated = RepositoryService.updateById(
      'MEETINGS','meeting_id',meetingId,{
        agenda:String(agenda || ''),
        updated_at:new Date()
      }
    );

    if (!updated) throw new Error('Không tìm thấy cuộc họp.');

    ActivityService.log('UPDATE_AGENDA','MEETING',meetingId,{});
    return updated;
  }

  function createTaskFromConclusion(meetingId, payload) {
    AuthService.requirePermission('tasks.create');

    const meeting = RepositoryService.findById(
      'MEETINGS','meeting_id',meetingId
    );
    if (!meeting) throw new Error('Không tìm thấy cuộc họp.');

    return TaskService.create({
      title: payload.title || ('Thực hiện kết luận: ' + meeting.title),
      description: payload.description || meeting.agenda || '',
      source_type: 'MEETING',
      source_id: meetingId,
      priority: payload.priority || 'NORMAL',
      owner_user_id: payload.owner_user_id || '',
      collaborator_ids: payload.collaborator_ids || '',
      due_date: payload.due_date || '',
      conclusion_item_no: payload.conclusion_item_no || ''
    });
  }

  return {
    list,
    create,
    updateAgenda,
    createTaskFromConclusion
  };
})();

const DashboardService = (() => {
  function get() {
    AuthService.requirePermission('dashboard.view');

    const docs = DocumentService.list();
    const tasks = TaskService.list();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const todayKey = Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');

    const taskDueDate = t => {
      if (!t.due_date) return null;
      const d = new Date(t.due_date);
      return isNaN(d) ? null : d;
    };

    const unfinished = t => !['COMPLETED','CANCELLED'].includes(t.status);

    const taskToday = tasks.filter(t => {
      const d = taskDueDate(t);
      return d && unfinished(t) &&
        Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') === todayKey;
    });

    const dueSoon = tasks.filter(t => {
      const d = taskDueDate(t);
      return d && unfinished(t) && d >= now && d <= in48h;
    });

    const overdue = tasks.filter(t => {
      const d = taskDueDate(t);
      return d && unfinished(t) && d < now;
    });

    const processingTasks = tasks.filter(t => unfinished(t))
      .sort((a,b) => {
        const ad = taskDueDate(a), bd = taskDueDate(b);
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return ad - bd;
      }).slice(0,4);

    return {
      stats: {
        newDocuments: docs.filter(d => d.status === 'NEW').length,
        tasksToday: taskToday.length,
        dueSoon: dueSoon.length,
        overdue: overdue.length
      },
      documents: {
        total: docs.length,
        incoming: docs.filter(d => d.direction === 'INCOMING').length,
        outgoing: docs.filter(d => d.direction === 'OUTGOING').length,
        processing: docs.filter(d => ['NEW','PROCESSING','WAITING_APPROVAL'].includes(d.status)).length,
        dueSoon: docs.filter(d => {
          if (!d.due_date || ['COMPLETED','ARCHIVED'].includes(d.status)) return false;
          const x = new Date(d.due_date);
          return !isNaN(x) && x >= now && x <= in48h;
        }).length
      },
      tasks: {
        total: tasks.length,
        newCount: tasks.filter(t => t.effective_status === 'NEW').length,
        inProgress: tasks.filter(t => t.effective_status === 'IN_PROGRESS').length,
        waitingApproval: tasks.filter(t => t.effective_status === 'WAITING_APPROVAL').length,
        overdue: tasks.filter(t => t.effective_status === 'OVERDUE').length,
        completed: tasks.filter(t => t.status === 'COMPLETED').length
      },
      priorityTasks: processingTasks,
      recentDocuments: docs.slice(0,3)
    };
  }
  return {get};
})();