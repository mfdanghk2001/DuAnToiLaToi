function apiB5GetAdminData() {
  return B5AdminService.getAdminData();
}

function apiB5CreateUser(payload) {
  return B5AdminService.createUser(payload || {});
}

function apiB5UpdateUser(userId, payload) {
  return B5AdminService.updateUser(userId, payload || {});
}

function apiB5CreateDepartment(payload) {
  return B5AdminService.createDepartment(payload || {});
}

function apiB5UpdateDepartment(departmentId, payload) {
  return B5AdminService.updateDepartment(departmentId, payload || {});
}