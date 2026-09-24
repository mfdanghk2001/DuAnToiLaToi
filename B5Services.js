const B5AdminService = (() => {
  const VALID_ROLES = ['ADMIN','LEADER','OFFICE','STAFF'];
  const VALID_STATUS = ['ACTIVE','INACTIVE'];

  const ROLE_INFO = {
    ADMIN: {
      name: 'Quản trị hệ thống',
      description: 'Toàn quyền cấu hình, người dùng và toàn bộ nghiệp vụ.'
    },
    LEADER: {
      name: 'Lãnh đạo',
      description: 'Theo dõi, xem báo cáo, văn bản, nhiệm vụ, lịch và cuộc họp.'
    },
    OFFICE: {
      name: 'Văn phòng',
      description: 'Tiếp nhận văn bản, giao việc, lịch, họp, tham mưu, báo cáo và kho tài liệu.'
    },
    STAFF: {
      name: 'Cán bộ / Chuyên viên',
      description: 'Theo dõi dữ liệu được phép và cập nhật nhiệm vụ cá nhân.'
    }
  };

  function requireAdmin_() {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated || me.role !== 'ADMIN') {
      throw new Error('Chỉ tài khoản ADMIN mới được sử dụng chức năng quản trị.');
    }
    return me;
  }

  function clean_(v) {
    return String(v == null ? '' : v).trim();
  }

  function validEmail_(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function normalizeRole_(role) {
    const r = clean_(role).toUpperCase();
    if (!VALID_ROLES.includes(r)) throw new Error('Vai trò không hợp lệ.');
    return r;
  }

  function normalizeStatus_(status) {
    const s = clean_(status || 'ACTIVE').toUpperCase();
    if (!VALID_STATUS.includes(s)) throw new Error('Trạng thái không hợp lệ.');
    return s;
  }

  function departmentMap_() {
    const map = {};
    RepositoryService.getAll('DEPARTMENTS').forEach(d => {
      map[d.department_id] = d.department_name;
    });
    return map;
  }

  function getAdminData() {
    const me = requireAdmin_();
    const departments = RepositoryService.getAll('DEPARTMENTS')
      .sort((a,b) => String(a.department_name).localeCompare(String(b.department_name), 'vi'));

    const deptMap = {};
    departments.forEach(d => deptMap[d.department_id] = d.department_name);

    const users = AuthService.listUsersCached()
      .sort((a,b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email), 'vi'))
      .map(u => ({
        ...u,
        department_name: deptMap[u.department_id] || '',
        is_current_user: u.user_id === me.userId
      }));

    return {
      currentUserId: me.userId,
      users,
      departments,
      roles: VALID_ROLES.map(code => ({
        code,
        name: ROLE_INFO[code].name,
        description: ROLE_INFO[code].description,
        permissions: AuthService.ROLE_PERMISSIONS[code] || []
      }))
    };
  }

  function createUser(payload) {
    const me = requireAdmin_();
    payload = payload || {};

    const email = clean_(payload.email).toLowerCase();
    const fullName = clean_(payload.full_name);
    const role = normalizeRole_(payload.role || 'STAFF');
    const status = normalizeStatus_(payload.status || 'ACTIVE');
    const departmentId = clean_(payload.department_id);
    const phone = clean_(payload.phone);

    if (!validEmail_(email)) throw new Error('Email không hợp lệ.');
    if (!fullName) throw new Error('Họ và tên không được để trống.');

    const users = AuthService.listUsersCached();
    if (users.some(u => clean_(u.email).toLowerCase() === email)) {
      throw new Error('Email này đã tồn tại trong hệ thống.');
    }

    if (departmentId) {
      const dept = RepositoryService.findById('DEPARTMENTS','department_id',departmentId);
      if (!dept) throw new Error('Đơn vị không tồn tại.');
    }

    const now = new Date();
    const data = {
      user_id: uuid_(),
      email,
      full_name: fullName,
      department_id: departmentId,
      role,
      status,
      phone,
      avatar_url: '',
      last_login_at: '',
      created_at: now,
      updated_at: now
    };

    RepositoryService.append('USERS', data);
    ActivityService.log('CREATE','USER',data.user_id,{
      email,
      role,
      createdBy: me.userId
    });

    return data;
  }

  function updateUser(userId, payload) {
    const me = requireAdmin_();
    payload = payload || {};

    const current = RepositoryService.findById('USERS','user_id',userId);
    if (!current) throw new Error('Không tìm thấy người dùng.');

    const role = normalizeRole_(payload.role || current.role);
    const status = normalizeStatus_(payload.status || current.status);
    const fullName = clean_(payload.full_name || current.full_name);
    const departmentId = clean_(
      payload.department_id !== undefined
        ? payload.department_id
        : current.department_id
    );
    const phone = clean_(
      payload.phone !== undefined
        ? payload.phone
        : current.phone
    );

    if (!fullName) throw new Error('Họ và tên không được để trống.');

    if (departmentId) {
      const dept = RepositoryService.findById('DEPARTMENTS','department_id',departmentId);
      if (!dept) throw new Error('Đơn vị không tồn tại.');
    }

    // Không cho tự khóa chính mình.
    if (userId === me.userId && status !== 'ACTIVE') {
      throw new Error('Bạn không thể tự vô hiệu hóa tài khoản đang đăng nhập.');
    }

    // Bảo vệ hệ thống khỏi mất ADMIN cuối cùng.
    if (current.role === 'ADMIN' && (role !== 'ADMIN' || status !== 'ACTIVE')) {
      const activeAdmins = AuthService.listUsersCached()
        .filter(u => u.role === 'ADMIN' && u.status === 'ACTIVE');

      if (activeAdmins.length <= 1) {
        throw new Error('Hệ thống phải luôn còn ít nhất 1 ADMIN đang hoạt động.');
      }
    }

    const patch = {
      full_name: fullName,
      department_id: departmentId,
      role,
      status,
      phone,
      updated_at: new Date()
    };

    const updated = RepositoryService.updateById(
      'USERS','user_id',userId,patch
    );

    ActivityService.log('UPDATE','USER',userId,{
      role,
      status,
      updatedBy: me.userId
    });

    return updated;
  }

  function createDepartment(payload) {
    const me = requireAdmin_();
    payload = payload || {};

    const code = clean_(payload.department_code).toUpperCase();
    const name = clean_(payload.department_name);

    if (!code) throw new Error('Mã đơn vị không được để trống.');
    if (!name) throw new Error('Tên đơn vị không được để trống.');
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
      throw new Error('Mã đơn vị chỉ dùng A-Z, 0-9, dấu _ hoặc - (2-20 ký tự).');
    }

    const deps = RepositoryService.getAll('DEPARTMENTS');
    if (deps.some(d => clean_(d.department_code).toUpperCase() === code)) {
      throw new Error('Mã đơn vị đã tồn tại.');
    }

    const now = new Date();
    const data = {
      department_id: uuid_(),
      department_code: code,
      department_name: name,
      parent_id: clean_(payload.parent_id),
      status: 'ACTIVE',
      created_at: now,
      updated_at: now
    };

    RepositoryService.append('DEPARTMENTS', data);
    ActivityService.log('CREATE','DEPARTMENT',data.department_id,{
      code,
      name,
      createdBy: me.userId
    });

    return data;
  }

  function updateDepartment(departmentId, payload) {
    const me = requireAdmin_();
    payload = payload || {};

    const current = RepositoryService.findById(
      'DEPARTMENTS','department_id',departmentId
    );
    if (!current) throw new Error('Không tìm thấy đơn vị.');

    const name = clean_(payload.department_name || current.department_name);
    const status = normalizeStatus_(payload.status || current.status);

    if (!name) throw new Error('Tên đơn vị không được để trống.');

    if (status === 'INACTIVE') {
      const activeUsers = AuthService.listUsersCached()
        .filter(u => u.department_id === departmentId && u.status === 'ACTIVE');
      if (activeUsers.length) {
        throw new Error('Không thể ngừng sử dụng đơn vị đang có người dùng hoạt động.');
      }
    }

    const updated = RepositoryService.updateById(
      'DEPARTMENTS','department_id',departmentId,{
        department_name: name,
        status,
        updated_at: new Date()
      }
    );

    ActivityService.log('UPDATE','DEPARTMENT',departmentId,{
      status,
      updatedBy: me.userId
    });

    return updated;
  }

  return {
    getAdminData,
    createUser,
    updateUser,
    createDepartment,
    updateDepartment
  };
})();