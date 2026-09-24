function doGet() {
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('Văn phòng Đảng ủy số')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Hàm gọi từ giao diện ở các bước sau.
 * Hiện B1 chỉ trả trạng thái hệ thống + người dùng hiện tại.
 */
function getBootstrapData() {
  return {
    ok: true,
    system: SystemConfig.getSystemInfo(),
    user: AuthService.getCurrentUser(),
    now: new Date().toISOString()
  };
}