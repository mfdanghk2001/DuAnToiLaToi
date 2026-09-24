const AuthService = (() => {
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
    return (
      Session.getActiveUser().getEmail() ||
      Session.getEffectiveUser().getEmail() ||
      ''
    ).toLowerCase();
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

    const users = RepositoryService.getAll('USERS');
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

  return {getCurrentUser, hasPermission, requirePermission, ROLE_PERMISSIONS};
})();