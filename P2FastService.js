const P2FastService = (() => {
  function prefetch() {
    const started = Date.now();
    const user = AuthService.getCurrentUser();
    if (!user.authenticated) {
      return {ok:false,error:'UNAUTHORIZED',message:user.message||'Chưa đăng nhập.'};
    }

    const result = {
      ok:true,
      documents:null,
      tasks:null,
      todayCalendar:null,
      calendar:null,
      meetings:null,
      server_ms:0
    };

    const perms = user.permissions || [];
    const has = p => perms.includes('*') || perms.includes(p);

    if (has('documents.view')) {
      result.documents = D1DocumentService.list({
        q:'',
        direction:'ALL',
        status:'ALL',
        year:'ALL',
        issuer:'ALL',
        field:'ALL',
        assignee:'ALL',
        priority:'ALL',
        page:1,
        pageSize:10
      });
    }

    if (has('tasks.view')) {
      result.tasks = D2TaskService.list({
        q:'',
        status:'ALL',
        owner:'ALL',
        priority:'ALL',
        sourceType:'ALL',
        due:'ALL',
        page:1,
        pageSize:10
      });
    }

    if (has('calendar.view')) {
      const today = Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      result.calendar = F1CompleteService.calendarList({});
      result.todayCalendar = {
        items:(result.calendar.items || []).filter(x =>
          String(x.event_date || '').slice(0,10) === today &&
          (!x.status || x.status === 'ACTIVE')
        )
      };
    }

    if (has('meetings.view')) {
      result.meetings = F1CompleteService.meetingList({q:''});
    }

    result.server_ms = Date.now() - started;
    return result;
  }

  return {prefetch};
})();