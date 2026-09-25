const B6NotificationService = (() => {
  const MAX_LIST = 60;

  function currentUser_() {
    const user = AuthService.getCurrentUser();
    if (!user.authenticated) throw new Error('Chưa đăng nhập.');
    return user;
  }

  function serializeNotification_(n) {
    return {
      ...n,
      is_read: n.is_read === true || String(n.is_read).toUpperCase() === 'TRUE'
    };
  }

  function listForCurrentUser() {
    const user = currentUser_();

    return RepositoryService.getAll('NOTIFICATIONS')
      .filter(n => n.user_id === user.userId)
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, MAX_LIST)
      .map(serializeNotification_);
  }

  function markRead(notificationId) {
    const user = currentUser_();
    const row = RepositoryService.findById(
      'NOTIFICATIONS','notification_id',notificationId
    );

    if (!row || row.user_id !== user.userId) {
      throw new Error('Không tìm thấy thông báo.');
    }

    return RepositoryService.updateById(
      'NOTIFICATIONS','notification_id',notificationId,{
        is_read: true,
        read_at: new Date()
      }
    );
  }

  function markAllRead() {
    const user = currentUser_();
    const rows = RepositoryService.getAll('NOTIFICATIONS')
      .filter(n =>
        n.user_id === user.userId &&
        !(n.is_read === true || String(n.is_read).toUpperCase() === 'TRUE')
      );

    const readAt = new Date();
    RepositoryService.batchUpdateByIds(
      'NOTIFICATIONS',
      'notification_id',
      rows.map(n => ({
        id:n.notification_id,
        patch:{is_read:true,read_at:readAt}
      }))
    );

    return {updated: rows.length};
  }

  function create_(payload) {
    if (!payload.user_id) return null;

    const data = {
      notification_id: uuid_(),
      user_id: payload.user_id,
      type: payload.type || 'INFO',
      title: payload.title || 'Thông báo',
      message: payload.message || '',
      reference_type: payload.reference_type || '',
      reference_id: payload.reference_id || '',
      is_read: false,
      created_at: new Date(),
      read_at: ''
    };

    RepositoryService.append('NOTIFICATIONS', data);
    return data;
  }

  function notificationKey_(userId, type, refType, refId) {
    return [userId,type,refType,String(refId)].join('|');
  }

  function exists_(indexOrRows, userId, type, refType, refId) {
    const key = notificationKey_(userId,type,refType,refId);
    if (indexOrRows instanceof Set) return indexOrRows.has(key);
    return indexOrRows.some(n =>
      notificationKey_(n.user_id,n.type,n.reference_type,n.reference_id) === key
    );
  }

  function dueText_(due) {
    return Utilities.formatDate(
      due,
      'Asia/Ho_Chi_Minh',
      'dd/MM/yyyy HH:mm'
    );
  }

  /**
   * Được gọi bởi time trigger.
   * Không dùng AuthService vì trigger không có phiên người dùng tương tác.
   */
  function scanReminders() {
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const users = AuthService.listActiveUsersCached();
    const activeUserIds = new Set(users.map(u => u.user_id));

    const notifications = RepositoryService.getAll('NOTIFICATIONS');
    const notificationIndex = new Set(
      notifications.map(n => notificationKey_(n.user_id,n.type,n.reference_type,n.reference_id))
    );

    let created = 0;

    // 1) Task: được giao / sắp hạn / quá hạn
    const tasks = RepositoryService.getAll('TASKS')
      .filter(t => !['COMPLETED','CANCELLED'].includes(t.status));

    tasks.forEach(t => {
      const owner = t.owner_user_id;
      if (!owner || !activeUserIds.has(owner)) return;

      if (!exists_(notificationIndex, owner, 'TASK_ASSIGNED', 'TASK', t.task_id)) {
        const n = create_({
          user_id: owner,
          type: 'TASK_ASSIGNED',
          title: 'Nhiệm vụ được giao',
          message: `Bạn đang phụ trách: ${t.title || 'Nhiệm vụ mới'}`,
          reference_type: 'TASK',
          reference_id: t.task_id
        });
        if (n) {
          notifications.push(n);
          notificationIndex.add(notificationKey_(n.user_id,n.type,n.reference_type,n.reference_id));
          created++;
        }
      }

      if (!t.due_date) return;
      const due = new Date(t.due_date);
      if (isNaN(due)) return;

      if (due < now) {
        if (!exists_(notificationIndex, owner, 'TASK_OVERDUE', 'TASK', t.task_id)) {
          const n = create_({
            user_id: owner,
            type: 'TASK_OVERDUE',
            title: 'Nhiệm vụ đã quá hạn',
            message: `${t.title || 'Nhiệm vụ'} · hạn ${dueText_(due)}`,
            reference_type: 'TASK',
            reference_id: t.task_id
          });
          if (n) {
          notifications.push(n);
          notificationIndex.add(notificationKey_(n.user_id,n.type,n.reference_type,n.reference_id));
          created++;
        }
        }
      } else if (due <= next24h) {
        if (!exists_(notificationIndex, owner, 'TASK_DUE_SOON', 'TASK', t.task_id)) {
          const n = create_({
            user_id: owner,
            type: 'TASK_DUE_SOON',
            title: 'Nhiệm vụ sắp đến hạn',
            message: `${t.title || 'Nhiệm vụ'} · hạn ${dueText_(due)}`,
            reference_type: 'TASK',
            reference_id: t.task_id
          });
          if (n) {
          notifications.push(n);
          notificationIndex.add(notificationKey_(n.user_id,n.type,n.reference_type,n.reference_id));
          created++;
        }
        }
      }
    });

    // 2) Văn bản sắp đến hạn -> người xử lý
    const documents = RepositoryService.getAll('DOCUMENTS')
      .filter(d => !['COMPLETED','ARCHIVED'].includes(d.status));

    documents.forEach(d => {
      const assignee = d.assignee_user_id;
      if (!assignee || !activeUserIds.has(assignee) || !d.due_date) return;

      const due = new Date(d.due_date);
      if (isNaN(due)) return;

      if (due >= now && due <= next24h) {
        if (!exists_(notificationIndex, assignee, 'DOCUMENT_DUE_SOON', 'DOCUMENT', d.document_id)) {
          const n = create_({
            user_id: assignee,
            type: 'DOCUMENT_DUE_SOON',
            title: 'Văn bản sắp đến hạn xử lý',
            message: `${d.document_no || 'Văn bản'} · ${d.title || ''}`,
            reference_type: 'DOCUMENT',
            reference_id: d.document_id
          });
          if (n) {
          notifications.push(n);
          notificationIndex.add(notificationKey_(n.user_id,n.type,n.reference_type,n.reference_id));
          created++;
        }
        }
      }
    });

    // 3) Cuộc họp trong 24 giờ -> người tạo + thành viên nội bộ
    const meetings = RepositoryService.getAll('MEETINGS')
      .filter(m => !['COMPLETED','CANCELLED'].includes(m.status));

    const meetingMembers = RepositoryService.getAll('MEETING_MEMBERS');

    meetings.forEach(m => {
      if (!m.meeting_date) return;

      const datePart = String(m.meeting_date).slice(0,10);
      const timePart = m.start_time || '00:00';
      const dt = new Date(`${datePart}T${timePart}`);
      if (isNaN(dt) || dt < now || dt > next24h) return;

      const recipients = new Set();
      if (m.created_by && activeUserIds.has(m.created_by)) recipients.add(m.created_by);
      meetingMembers
        .filter(x => x.meeting_id === m.meeting_id && x.user_id && activeUserIds.has(x.user_id))
        .forEach(x => recipients.add(x.user_id));

      recipients.forEach(userId => {
        if (exists_(notificationIndex, userId, 'MEETING_UPCOMING', 'MEETING', m.meeting_id)) return;

        const n = create_({
          user_id: userId,
          type: 'MEETING_UPCOMING',
          title: 'Cuộc họp sắp diễn ra',
          message: `${m.title || 'Cuộc họp'} · ${dueText_(dt)}`,
          reference_type: 'MEETING',
          reference_id: m.meeting_id
        });
        if (n) {
          notifications.push(n);
          notificationIndex.add(notificationKey_(n.user_id,n.type,n.reference_type,n.reference_id));
          created++;
        }
      });
    });

    return {
      ok: true,
      created,
      scannedAt: new Date().toISOString()
    };
  }

  return {
    listForCurrentUser,
    markRead,
    markAllRead,
    scanReminders
  };
})();


const B6ActivityService = (() => {
  function getLogs(limit) {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated || me.role !== 'ADMIN') {
      throw new Error('Chỉ ADMIN được xem nhật ký hoạt động.');
    }

    const users = AuthService.listUsersCached();
    const userMap = {};
    users.forEach(u => userMap[u.user_id] = u.full_name || u.email);

    const max = Math.max(1, Math.min(Number(limit || 200), 500));

    return RepositoryService.getAll('ACTIVITY_LOG')
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, max)
      .map(log => {
        let detail = {};
        try {
          detail = log.detail_json ? JSON.parse(log.detail_json) : {};
        } catch (e) {
          detail = {raw: log.detail_json || ''};
        }

        return {
          ...log,
          actor_name: userMap[log.user_id] || 'Hệ thống',
          detail
        };
      });
  }

  return {getLogs};
})();