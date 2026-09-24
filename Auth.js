const AuthService = (() => {
  const USERS_CACHE_KEY = 'VPDU_AUTH_USERS_V1';
  const USERS_CACHE_SECONDS = 300;
  let runtimeUsers = null;
  let runtimeCurrentUser = null;
  let runtimeOverrideUser = null;

  const ROLE_PERMISSIONS = {
    ADMIN: ['*'],
    LEADER: [
      'dashboard.view','documents.view','tasks.view','tasks.approve',
      'calendar.view','meetings.view','reports.view','repository.view'
    ],
    OFFICE: [
      'dashboard.view',
      'documents.view','documents.create','documents.update',
      'tasks.view','tasks.create','tasks.update',
      'calendar.view','calendar.create','calendar.update',
      'meetings.view','meetings.create','meetings.update',
      'advisory.use','reports.view','reports.create',
      'repository.view','repository.upload'
    ],
    STAFF: [
      'dashboard.view','documents.view','tasks.view','tasks.update_own',
      'calendar.view','meetings.view','repository.view'
    ]
  };

  function getSessionEmail_() {
    // SECURITY: chỉ dùng danh tính người đang truy cập.
    // Không fallback sang EffectiveUser vì web app chạy dưới tài khoản deployer;
    // fallback đó có thể khiến khách truy cập bị nhận nhầm thành tài khoản deploy.
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  }

  function listUsersCached() {
    if (runtimeUsers) return runtimeUsers;
    const cache = CacheService.getScriptCache();
    const hit = cache.get(USERS_CACHE_KEY);
    if (hit) {
      try {
        runtimeUsers = JSON.parse(hit);
        return runtimeUsers;
      } catch (e) {}
    }

    const users = RepositoryService.getAll('USERS');
    runtimeUsers = users;
    try {
      cache.put(USERS_CACHE_KEY, JSON.stringify(users), USERS_CACHE_SECONDS);
    } catch (e) {}
    return runtimeUsers;
  }

  function listActiveUsersCached() {
    return listUsersCached().filter(u => u.status === 'ACTIVE');
  }

  function clearCache() {
    runtimeUsers = null;
    runtimeCurrentUser = null;
    try {
      CacheService.getScriptCache().remove(USERS_CACHE_KEY);
    } catch (e) {}
  }

  function getCurrentUser() {
    // Password-auth mode: business APIs are authenticated only when apiDispatch()
    // injects a validated application session into this execution.
    // Never fall back to Google Session identity, otherwise a direct API call
    // could bypass the app's username/password gateway.
    if (runtimeOverrideUser) return runtimeOverrideUser;

    return {
      authenticated:false,
      email:'',
      role:'',
      permissions:[],
      message:'Phiên đăng nhập ứng dụng không hợp lệ.'
    };
  }

  function setRuntimeUser(user) {
    runtimeOverrideUser = user || null;
    if (user) runtimeCurrentUser = user;
  }

  function clearRuntimeUser() {
    runtimeOverrideUser = null;
  }

  function hasPermission(permission) {
    const user = getCurrentUser();
    if (!user.authenticated) return false;
    const perms = user.permissions || [];
    return perms.includes('*') || perms.includes(permission);
  }

  function requirePermission(permission) {
    if (!hasPermission(permission)) {
      throw new Error('Bạn không có quyền thực hiện chức năng: ' + permission);
    }
    return true;
  }

  return {
    getCurrentUser,
    setRuntimeUser,
    clearRuntimeUser,
    hasPermission,
    requirePermission,
    listUsersCached,
    listActiveUsersCached,
    clearCache,
    ROLE_PERMISSIONS
  };
})();