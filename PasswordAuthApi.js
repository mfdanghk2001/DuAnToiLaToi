function apiPasswordLogin(login, password) {
  try {
    const result = PasswordAuthService.login(login, password);
    if (result && result.ok && result.user) {
      AuthService.setRuntimeUser(result.user);
      result.workspace = P1FastService.bootstrap();
    }
    return result;
  } catch (e) {
    return {
      ok:false,
      error:e && e.code ? e.code : 'LOGIN_FAILED',
      message:e && e.message ? e.message : String(e)
    };
  }
}

function apiPasswordLogout(token) {
  return PasswordAuthService.logout(token || '');
}

function apiPasswordAdminSetUserPassword(userId, newPassword) {
  return PasswordAuthService.setUserPassword(userId, newPassword);
}

function apiPasswordChangeOwnPassword(currentPassword, newPassword) {
  return PasswordAuthService.changeOwnPassword(currentPassword, newPassword);
}

function apiPasswordStatus(userId) {
  return PasswordAuthService.passwordStatus(userId);
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

  return fn.apply(null, args);
}