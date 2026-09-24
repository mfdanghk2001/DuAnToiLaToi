const P1FastService = (() => {
  function effectiveTaskStatus_(task, now) {
    if (
      task.due_date &&
      !['COMPLETED','CANCELLED'].includes(task.status)
    ) {
      const due = new Date(task.due_date);
      if (!isNaN(due) && due < now) return 'OVERDUE';
    }
    return task.status || 'NEW';
  }

  function buildDashboard_(docs, tasks, users) {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const todayKey = Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');

    const names = {};
    users.forEach(u => names[u.user_id] = u.full_name || u.email || u.user_id);

    const enrichedTasks = tasks.map(t => ({
      ...t,
      progress:Number(t.progress || 0),
      effective_status:effectiveTaskStatus_(t,now),
      owner_name:names[t.owner_user_id] || '',
      assigner_name:names[t.assigner_user_id] || ''
    }));

    const taskDueDate = t => {
      if (!t.due_date) return null;
      const d = new Date(t.due_date);
      return isNaN(d) ? null : d;
    };

    const unfinished = t => !['COMPLETED','CANCELLED'].includes(t.status);

    const taskToday = enrichedTasks.filter(t => {
      const d = taskDueDate(t);
      return d && unfinished(t) &&
        Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') === todayKey;
    });

    const dueSoon = enrichedTasks.filter(t => {
      const d = taskDueDate(t);
      return d && unfinished(t) && d >= now && d <= in48h;
    });

    const overdue = enrichedTasks.filter(t => {
      const d = taskDueDate(t);
      return d && unfinished(t) && d < now;
    });

    const processingTasks = enrichedTasks
      .filter(t => unfinished(t))
      .sort((a,b) => {
        const ad = taskDueDate(a), bd = taskDueDate(b);
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return ad - bd;
      })
      .slice(0,4);

    const enrichedDocs = docs
      .slice()
      .sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .map(d => ({
        ...d,
        assignee_name:names[d.assignee_user_id] || '',
        file_url:d.drive_file_id
          ? ('https://drive.google.com/open?id=' + d.drive_file_id)
          : ''
      }));

    return {
      stats:{
        newDocuments:docs.filter(d => d.status === 'NEW').length,
        tasksToday:taskToday.length,
        dueSoon:dueSoon.length,
        overdue:overdue.length
      },
      documents:{
        total:docs.length,
        incoming:docs.filter(d => d.direction === 'INCOMING' && d.status !== 'ARCHIVED').length,
        outgoing:docs.filter(d => d.direction === 'OUTGOING' && d.status !== 'ARCHIVED').length,
        processing:docs.filter(d => ['NEW','PROCESSING','WAITING_APPROVAL'].includes(d.status)).length,
        dueSoon:docs.filter(d => {
          if (!d.due_date || ['COMPLETED','ARCHIVED'].includes(d.status)) return false;
          const x = new Date(d.due_date);
          return !isNaN(x) && x >= now && x <= in48h;
        }).length
      },
      tasks:{
        total:enrichedTasks.length,
        newCount:enrichedTasks.filter(t => t.effective_status === 'NEW').length,
        inProgress:enrichedTasks.filter(t => t.effective_status === 'IN_PROGRESS').length,
        waitingApproval:enrichedTasks.filter(t => t.effective_status === 'WAITING_APPROVAL').length,
        overdue:enrichedTasks.filter(t => t.effective_status === 'OVERDUE').length,
        completed:enrichedTasks.filter(t => t.status === 'COMPLETED').length
      },
      priorityTasks:processingTasks,
      recentDocuments:enrichedDocs.slice(0,3)
    };
  }

  function dashboard() {
    const started = Date.now();
    const user = AuthService.getCurrentUser();
    if (!user.authenticated) {
      throw new Error(user.message || 'Tài khoản chưa được cấp quyền.');
    }
    if (!AuthService.hasPermission('dashboard.view')) {
      throw new Error('Bạn không có quyền xem Dashboard.');
    }

    const users = AuthService.listActiveUsersCached();
    const docs = RepositoryService.getAll('DOCUMENTS');
    const tasks = RepositoryService.getAll('TASKS');

    return {
      ok:true,
      dashboard:buildDashboard_(docs,tasks,users),
      server_ms:Date.now()-started
    };
  }

  function bootstrap() {
    const started = Date.now();
    const info = SystemConfig.getSystemInfo();
    if (!info.initialized) {
      return {
        ok:false,
        error:'NOT_INITIALIZED',
        message:'Hệ thống chưa được khởi tạo. Hãy chạy setupSystem().'
      };
    }

    const user = AuthService.getCurrentUser();
    if (!user.authenticated) {
      return {
        ok:false,
        error:'UNAUTHORIZED',
        message:user.message || 'Tài khoản chưa được cấp quyền.',
        user
      };
    }

    const users = AuthService.listActiveUsersCached();
    const docs = RepositoryService.getAll('DOCUMENTS');
    const tasks = RepositoryService.getAll('TASKS');

    const perms = user.permissions || [];
    const has = p => perms.includes('*') || perms.includes(p);
    const warm = {
      documents:null,
      tasks:null,
      todayCalendar:null,
      notifications:[]
    };

    if (has('documents.view')) {
      warm.documents = D1DocumentService.list({
        q:'',direction:'ALL',status:'ALL',year:'ALL',
        issuer:'ALL',field:'ALL',assignee:'ALL',priority:'ALL',
        page:1,pageSize:10
      });
    }

    if (has('tasks.view')) {
      warm.tasks = D2TaskService.list({
        q:'',status:'ALL',owner:'ALL',priority:'ALL',
        sourceType:'ALL',due:'ALL',page:1,pageSize:10,warm:true
      });
    }

    if (has('calendar.view')) {
      const today = Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      warm.todayCalendar = F1CompleteService.calendarList({from:today,to:today});
    }

    try {
      warm.notifications = B6NotificationService.listForCurrentUser();
    } catch (e) {
      warm.notifications = [];
    }

    return {
      ok:true,
      user,
      users:users.map(u => ({
        user_id:u.user_id,
        email:u.email,
        full_name:u.full_name,
        department_id:u.department_id,
        role:u.role
      })),
      dashboard:buildDashboard_(docs,tasks,users),
      documents:[],
      tasks:[],
      calendarEvents:[],
      meetings:[],
      warm,
      server_ms:Date.now()-started
    };
  }

  return {bootstrap, dashboard};
})();