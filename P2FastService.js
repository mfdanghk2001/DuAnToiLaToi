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

    result.server_ms = Date.now() - started;
    return result;
  }

  return {prefetch};
})();