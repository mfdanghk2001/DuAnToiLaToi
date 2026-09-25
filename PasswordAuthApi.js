function toClientSafe_(value) {
  if (value === null || value === undefined) return value === undefined ? null : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toClientSafe_);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(key => {
      const v = value[key];
      if (typeof v === 'function') return;
      out[key] = toClientSafe_(v);
    });
    return out;
  }
  return value;
}

function apiPasswordLogin(login, password) {
  try {
    const result = PasswordAuthService.login(login, password);
    if (result && result.ok && result.user) {
      AuthService.setRuntimeUser(result.user);
      result.workspace = P1FastService.bootstrap();
    }
    return toClientSafe_(result);
  } catch (e) {
    return {
      ok:false,
      error:e && e.code ? e.code : 'LOGIN_FAILED',
      message:e && e.message ? e.message : String(e)
    };
  }
}

function apiPasswordLogout(token) {
  return toClientSafe_(PasswordAuthService.logout(token || ''));
}

function apiPasswordAdminSetUserPassword(userId, newPassword) {
  return toClientSafe_(PasswordAuthService.setUserPassword(userId, newPassword));
}

function apiPasswordChangeOwnPassword(currentPassword, newPassword) {
  return toClientSafe_(PasswordAuthService.changeOwnPassword(currentPassword, newPassword));
}

function apiPasswordStatus(userId) {
  return toClientSafe_(PasswordAuthService.passwordStatus(userId));
}

function apiDispatch(apiName, args, token) {
  apiName = String(apiName || '').trim();
  args = Array.isArray(args) ? args : [];

  if (!/^api[A-Za-z0-9_]+$/.test(apiName)) {
    throw new Error('API không hợp lệ.');
  }

  if ([
    'apiDispatch',
    'apiPasswordLogin',
    'apiPasswordLogout'
  ].includes(apiName)) {
    throw new Error('API không được phép gọi qua dispatcher.');
  }

  const user = PasswordAuthService.validateSession(token || '');
  if (!user) {
    const err = new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }

  AuthService.setRuntimeUser(user);

  const fn = globalThis[apiName];
  if (typeof fn !== 'function') {
    throw new Error('Không tìm thấy API: ' + apiName);
  }

  return toClientSafe_(fn.apply(null, args));
}