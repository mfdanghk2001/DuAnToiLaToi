const PasswordAuthService = (() => {
  const SESSION_SHEET = 'AUTH_SESSIONS';
  const SESSION_HEADERS = [
    'session_id','user_id','token_hash','expires_at',
    'created_at','last_seen_at','revoked_at'
  ];

  const USER_AUTH_COLUMNS = [
    'password_salt','password_hash','password_changed_at',
    'failed_login_count','locked_until'
  ];

  const READY_KEY = 'VPDU_PASSWORD_AUTH_READY_V1';
  const PEPPER_PROP = 'VPDU_AUTH_PEPPER';
  const BOOTSTRAP_PROP = 'VPDU_BOOTSTRAP_PASSWORD';
  const SESSION_PREFIX = 'VPDU_SESSION_';
  const SESSION_HOURS = 8;
  const MAX_FAILURES = 5;
  const LOCK_MINUTES = 15;
  let runtimeReady = false;

  function clean_(v) {
    return String(v == null ? '' : v).trim();
  }

  function ensureReady_() {
    if (runtimeReady) return;

    const cache = CacheService.getScriptCache();
    try {
      if (cache.get(READY_KEY)) {
        runtimeReady = true;
        return;
      }
    } catch (e) {}

    const ss = SystemConfig.getDb();
    const users = ss.getSheetByName('USERS');
    if (!users) throw new Error('Không tìm thấy sheet USERS.');

    const lastCol = users.getLastColumn();
    const headers = lastCol
      ? users.getRange(1,1,1,lastCol).getValues()[0]
      : [];

    const missing = USER_AUTH_COLUMNS.filter(x => !headers.includes(x));
    if (missing.length) {
      users.getRange(1,lastCol+1,1,missing.length).setValues([missing]);
      users.getRange(1,lastCol+1,1,missing.length)
        .setFontWeight('bold')
        .setBackground('#991B1B')
        .setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');
    }

    if (!ss.getSheetByName(SESSION_SHEET)) {
      const sh = ss.insertSheet(SESSION_SHEET);
      sh.getRange(1,1,1,SESSION_HEADERS.length).setValues([SESSION_HEADERS]);
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,SESSION_HEADERS.length)
        .setFontWeight('bold')
        .setBackground('#991B1B')
        .setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');
    }

    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty(PEPPER_PROP)) {
      props.setProperty(
        PEPPER_PROP,
        Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()
      );
    }

    runtimeReady = true;
    try { cache.put(READY_KEY,'1',21600); } catch (e) {}
  }

  function sha256_(text) {
    return Utilities.base64Encode(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        String(text),
        Utilities.Charset.UTF_8
      )
    );
  }

  function constantTimeEqual_(a,b) {
    a = String(a || '');
    b = String(b || '');
    let diff = a.length ^ b.length;
    const len = Math.max(a.length,b.length);
    for (let i=0;i<len;i++) {
      diff |= (a.charCodeAt(i % Math.max(1,a.length)) || 0) ^
              (b.charCodeAt(i % Math.max(1,b.length)) || 0);
    }
    return diff === 0;
  }

  function passwordHash_(password,salt) {
    const pepper = PropertiesService.getScriptProperties().getProperty(PEPPER_PROP) || '';
    let value = String(password) + '|' + salt + '|' + pepper;
    // Nhiều vòng SHA-256 + pepper server-side. Đủ nhẹ để login nhanh,
    // nhưng tránh lưu mật khẩu hoặc hash một vòng trong Sheet.
    for (let i=0;i<700;i++) value = sha256_(value + '|' + salt);
    return value;
  }

  function validatePasswordPolicy_(password) {
    const p = String(password || '');
    if (p.length < 8) throw new Error('Mật khẩu phải có ít nhất 8 ký tự.');
    if (!/[A-Za-zÀ-ỹ]/.test(p) || !/[0-9]/.test(p)) {
      throw new Error('Mật khẩu cần có ít nhất 1 chữ và 1 số.');
    }
    return p;
  }

  function userByLogin_(login) {
    const key = clean_(login).toLowerCase();
    if (!key) return null;
    return AuthService.listUsersCached().find(u =>
      clean_(u.email).toLowerCase() === key
    ) || null;
  }

  function safeUser_(u) {
    return {
      authenticated:true,
      userId:u.user_id,
      email:u.email,
      fullName:u.full_name,
      departmentId:u.department_id,
      role:u.role,
      permissions:AuthService.ROLE_PERMISSIONS[u.role] || []
    };
  }

  function sessionCacheKey_(tokenHash) {
    return SESSION_PREFIX + tokenHash.slice(0,48);
  }

  function newToken_() {
    return Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now()
      )
    ).replace(/=+$/,'') + Utilities.getUuid().replace(/-/g,'');
  }

  function createSession_(userId) {
    ensureReady_();

    const token = newToken_();
    const tokenHash = sha256_(token);
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);

    const row = {
      session_id:Utilities.getUuid(),
      user_id:userId,
      token_hash:tokenHash,
      expires_at:expires,
      created_at:now,
      last_seen_at:now,
      revoked_at:''
    };
    RepositoryService.append(SESSION_SHEET,row);

    try {
      CacheService.getScriptCache().put(
        sessionCacheKey_(tokenHash),
        JSON.stringify({user_id:userId,expires_at:expires.toISOString()}),
        600
      );
    } catch (e) {}

    return {token,expiresAt:expires.toISOString()};
  }

  function recordFailure_(user) {
    const count = Number(user.failed_login_count || 0) + 1;
    const patch = {
      failed_login_count:count,
      updated_at:new Date()
    };
    if (count >= MAX_FAILURES) {
      patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      patch.failed_login_count = 0;
    }
    RepositoryService.updateById('USERS','user_id',user.user_id,patch);
    AuthService.clearCache();
  }

  function clearFailures_(userId) {
    RepositoryService.updateById('USERS','user_id',userId,{
      failed_login_count:0,
      locked_until:'',
      last_login_at:new Date(),
      updated_at:new Date()
    });
    AuthService.clearCache();
  }

  function setPassword_(userId,password) {
    ensureReady_();
    password = validatePasswordPolicy_(password);
    const salt = Utilities.getUuid() + Utilities.getUuid();
    const hash = passwordHash_(password,salt);

    const updated = RepositoryService.updateById('USERS','user_id',userId,{
      password_salt:salt,
      password_hash:hash,
      password_changed_at:new Date(),
      failed_login_count:0,
      locked_until:'',
      updated_at:new Date()
    });
    if (!updated) throw new Error('Không tìm thấy người dùng.');
    AuthService.clearCache();
    return true;
  }

  function login(login,password) {
    ensureReady_();
    const user = userByLogin_(login);

    // Trả lỗi chung để không tiết lộ email có tồn tại hay không.
    if (!user || user.status !== 'ACTIVE') {
      throw new Error('Tài khoản hoặc mật khẩu không đúng.');
    }

    if (user.locked_until) {
      const until = new Date(user.locked_until);
      if (!isNaN(until) && until > new Date()) {
        throw new Error('Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.');
      }
    }

    let valid = false;
    const hasPassword = Boolean(user.password_hash && user.password_salt);

    if (hasPassword) {
      valid = constantTimeEqual_(
        passwordHash_(String(password || ''),user.password_salt),
        user.password_hash
      );
    } else if (user.role === 'ADMIN') {
      // Lần đầu duy nhất: ADMIN dùng mật khẩu bootstrap trong Script Properties.
      const bootstrap = PropertiesService.getScriptProperties().getProperty(BOOTSTRAP_PROP) || '';
      if (!bootstrap) {
        const err = new Error('ADMIN chưa có mật khẩu. Hãy cấu hình Script Property VPDU_BOOTSTRAP_PASSWORD trước lần đăng nhập đầu tiên.');
        err.code = 'BOOTSTRAP_REQUIRED';
        throw err;
      }
      valid = constantTimeEqual_(String(password || ''),bootstrap);
      if (valid) {
        setPassword_(user.user_id,password);
        PropertiesService.getScriptProperties().deleteProperty(BOOTSTRAP_PROP);
      }
    }

    if (!valid) {
      recordFailure_(user);
      throw new Error('Tài khoản hoặc mật khẩu không đúng.');
    }

    clearFailures_(user.user_id);
    const fresh = RepositoryService.findById('USERS','user_id',user.user_id) || user;
    const session = createSession_(user.user_id);

    return {
      ok:true,
      token:session.token,
      expiresAt:session.expiresAt,
      user:safeUser_(fresh)
    };
  }

  function validateSession(token) {
    ensureReady_();
    token = clean_(token);
    if (!token) return null;

    const tokenHash = sha256_(token);
    let userId = '';
    let expiresAt = '';

    try {
      const hit = CacheService.getScriptCache().get(sessionCacheKey_(tokenHash));
      if (hit) {
        const data = JSON.parse(hit);
        userId = data.user_id || '';
        expiresAt = data.expires_at || '';
      }
    } catch (e) {}

    if (!userId) {
      const session = RepositoryService.getAll(SESSION_SHEET)
        .find(x => x.token_hash === tokenHash && !x.revoked_at);
      if (!session) return null;
      userId = session.user_id;
      expiresAt = session.expires_at;

      try {
        CacheService.getScriptCache().put(
          sessionCacheKey_(tokenHash),
          JSON.stringify({user_id:userId,expires_at:expiresAt}),
          600
        );
      } catch (e) {}
    }

    const expires = new Date(expiresAt);
    if (isNaN(expires) || expires <= new Date()) return null;

    const user = AuthService.listUsersCached()
      .find(x => x.user_id === userId && x.status === 'ACTIVE');
    if (!user) return null;

    return safeUser_(user);
  }

  function logout(token) {
    ensureReady_();
    const tokenHash = sha256_(clean_(token));
    const session = RepositoryService.getAll(SESSION_SHEET)
      .find(x => x.token_hash === tokenHash && !x.revoked_at);

    if (session) {
      RepositoryService.updateById(
        SESSION_SHEET,'session_id',session.session_id,{revoked_at:new Date()}
      );
    }
    try { CacheService.getScriptCache().remove(sessionCacheKey_(tokenHash)); } catch (e) {}
    return {ok:true};
  }

  function setUserPassword(userId,password) {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated || me.role !== 'ADMIN') {
      throw new Error('Chỉ ADMIN mới được đặt lại mật khẩu.');
    }
    const target = RepositoryService.findById('USERS','user_id',userId);
    if (!target) throw new Error('Không tìm thấy người dùng.');

    setPassword_(userId,password);
    ActivityService.log('RESET_PASSWORD','USER',userId,{updatedBy:me.userId});
    return {ok:true,user_id:userId};
  }

  function changeOwnPassword(currentPassword,newPassword) {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated) throw new Error('Phiên đăng nhập không hợp lệ.');

    const user = RepositoryService.findById('USERS','user_id',me.userId);
    if (!user || !user.password_hash || !user.password_salt) {
      throw new Error('Tài khoản chưa có mật khẩu hợp lệ.');
    }

    const ok = constantTimeEqual_(
      passwordHash_(String(currentPassword || ''),user.password_salt),
      user.password_hash
    );
    if (!ok) throw new Error('Mật khẩu hiện tại không đúng.');

    setPassword_(user.user_id,newPassword);
    ActivityService.log('CHANGE_PASSWORD','USER',user.user_id,{});
    return {ok:true};
  }

  function passwordStatus(userId) {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated || me.role !== 'ADMIN') {
      throw new Error('Chỉ ADMIN mới được xem trạng thái mật khẩu.');
    }
    const user = RepositoryService.findById('USERS','user_id',userId);
    return {
      user_id:userId,
      has_password:Boolean(user && user.password_hash && user.password_salt),
      password_changed_at:user ? user.password_changed_at || '' : ''
    };
  }

  return {
    login,
    validateSession,
    logout,
    setUserPassword,
    changeOwnPassword,
    passwordStatus
  };
})();