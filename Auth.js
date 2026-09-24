const AuthService = (() => {
  const USERS_CACHE_KEY = 'VPDU_AUTH_USERS_V1';
  const USERS_CACHE_SECONDS = 60;

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
    const cache = CacheService.getScriptCache();
    const hit = cache.get(USERS_CACHE_KEY);
    if (hit) {
      try {
        return JSON.parse(hit);
      } catch (e) {}
    }

    const users = RepositoryService.getAll('USERS');
    try {
      cache.put(USERS_CACHE_KEY, JSON.stringify(users), USERS_CACHE_SECONDS);
    } catch (e) {}
    return users;
  }

  function listActiveUsersCached() {
    return listUsersCached().filter(u => u.status === 'ACTIVE');
  }

  function clearCache() {
    try {
      CacheService.getScriptCache().remove(USERS_CACHE_KEY);
    } catch (e) {}
  }

  function getCurrentUser() {
    const system = SystemConfig.getSystemInfo();
    if (!system.initialized) {
      return {authenticated:false, email:getSessionEmail_(), role:'', permissions:[]};
    }

    const email = getSessionEmail_();
    if (!email) {
      return {
        authenticated:false,
        email:'',
        role:'',
        permissions:[],
        message:'Không lấy được email người dùng trong chế độ triển khai hiện tại.'
      };
    }

    const users = listUsersCached();
    const user = users.find(u => String(u.email).toLowerCase() === email && u.status === 'ACTIVE');

    if (!user) {
      return {
        authenticated:false,
        email,
        role:'',
        permissions:[],
        message:'Tài khoản chưa được cấp quyền trong hệ thống.'
      };
    }

    return {
      authenticated:true,
      userId:user.user_id,
      email:user.email,
      fullName:user.full_name,
      departmentId:user.department_id,
      role:user.role,
      permissions:ROLE_PERMISSIONS[user.role] || []
    };
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
    hasPermission,
    requirePermission,
    listUsersCached,
    listActiveUsersCached,
    clearCache,
    ROLE_PERMISSIONS
  };
})();