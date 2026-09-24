/**
 * B1 - Chạy hàm này DUY NHẤT MỘT LẦN sau khi dán source.
 * Hàm sẽ:
 * 1) Tạo Google Spreadsheet database.
 * 2) Tạo toàn bộ sheets + header.
 * 3) Tạo thư mục gốc và các thư mục con trên Google Drive.
 * 4) Tạo user ADMIN ban đầu theo tài khoản đang chạy Apps Script.
 * 5) Ghi cấu hình vào Script Properties.
 */
function setupSystem() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const props = SystemConfig.props();

    if (SystemConfig.getDbId() && SystemConfig.getRootFolderId()) {
      return {
        ok: false,
        message: 'Hệ thống đã được khởi tạo trước đó.',
        system: SystemConfig.getSystemInfo()
      };
    }

    const timestamp = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh',
      'yyyyMMdd_HHmmss'
    );

    // 1. Database
    const ss = SpreadsheetApp.create('VPDU_DATABASE_' + timestamp);
    ss.setSpreadsheetTimeZone('Asia/Ho_Chi_Minh');

    // Xóa sheet mặc định sau khi tạo sheets nghiệp vụ.
    const defaultSheet = ss.getSheets()[0];

    Object.entries(SystemConfig.SHEETS).forEach(([name, headers]) => {
      const sh = ss.insertSheet(name);
      initializeSheet_(sh, headers);
    });

    ss.deleteSheet(defaultSheet);

    // 2. Drive root + child folders
    const root = DriveApp.createFolder(SystemConfig.ROOT_FOLDER_NAME + '_' + timestamp);
    const folderMap = {};

    SystemConfig.DRIVE_FOLDERS.forEach(item => {
      const f = root.createFolder(item.name);
      folderMap[item.key] = f.getId();
    });

    // 3. Save props
    props.setProperties({
      [SystemConfig.PROP_DB_ID]: ss.getId(),
      [SystemConfig.PROP_ROOT_FOLDER_ID]: root.getId(),
      [SystemConfig.PROP_INITIALIZED_AT]: new Date().toISOString()
    }, true);

    // 4. Seed data
    seedSettings_(folderMap);
    seedCategories_();
    seedDepartments_();
    seedAdminUser_();

    // 5. Basic formatting
    formatDatabase_();

    return {
      ok: true,
      message: 'Khởi tạo hệ thống thành công.',
      spreadsheetId: ss.getId(),
      spreadsheetUrl: ss.getUrl(),
      rootFolderId: root.getId(),
      rootFolderUrl: root.getUrl(),
      folders: folderMap
    };
  } finally {
    lock.releaseLock();
  }
}

function initializeSheet_(sheet, headers) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);

  const header = sheet.getRange(1, 1, 1, headers.length);
  header.setFontWeight('bold');
  header.setBackground('#991B1B');
  header.setFontColor('#FFFFFF');
  header.setHorizontalAlignment('center');
  sheet.setRowHeight(1, 34);

  // Chừa sẵn filter.
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), headers.length).createFilter();
}

function seedSettings_(folderMap) {
  const sh = SystemConfig.getSheet('SETTINGS');
  const now = new Date();
  const rows = [
    ['SYSTEM_NAME', 'Văn phòng Đảng ủy số', 'Tên hệ thống', now],
    ['SYSTEM_VERSION', 'B1', 'Phiên bản backend/database hiện tại', now],
    ['TIMEZONE', 'Asia/Ho_Chi_Minh', 'Múi giờ hệ thống', now],
    ['ROOT_FOLDER_ID', SystemConfig.getRootFolderId(), 'Thư mục gốc trên Drive', now],
    ['FOLDER_INCOMING', folderMap.INCOMING, 'Văn bản đến', now],
    ['FOLDER_OUTGOING', folderMap.OUTGOING, 'Văn bản đi', now],
    ['FOLDER_DRAFTS', folderMap.DRAFTS, 'Dự thảo', now],
    ['FOLDER_MEETINGS', folderMap.MEETINGS, 'Cuộc họp', now],
    ['FOLDER_REPORTS', folderMap.REPORTS, 'Báo cáo', now],
    ['FOLDER_TEMPLATES', folderMap.TEMPLATES, 'Mẫu văn bản', now],
    ['FOLDER_REFERENCES', folderMap.REFERENCES, 'Tài liệu tham khảo', now],
    ['FOLDER_ATTACHMENTS', folderMap.ATTACHMENTS, 'Tệp đính kèm', now]
  ];
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedCategories_() {
  const sh = SystemConfig.getSheet('CATEGORIES');
  const rows = [
    [uuid_(),'DOCUMENT_STATUS','NEW','Mới tiếp nhận',10,'ACTIVE'],
    [uuid_(),'DOCUMENT_STATUS','PROCESSING','Đang xử lý',20,'ACTIVE'],
    [uuid_(),'DOCUMENT_STATUS','WAITING_APPROVAL','Chờ phê duyệt',30,'ACTIVE'],
    [uuid_(),'DOCUMENT_STATUS','COMPLETED','Hoàn thành',40,'ACTIVE'],
    [uuid_(),'DOCUMENT_STATUS','ARCHIVED','Lưu trữ',50,'ACTIVE'],

    [uuid_(),'TASK_STATUS','NEW','Chưa xử lý',10,'ACTIVE'],
    [uuid_(),'TASK_STATUS','IN_PROGRESS','Đang thực hiện',20,'ACTIVE'],
    [uuid_(),'TASK_STATUS','WAITING_APPROVAL','Chờ duyệt',30,'ACTIVE'],
    [uuid_(),'TASK_STATUS','COMPLETED','Hoàn thành',40,'ACTIVE'],
    [uuid_(),'TASK_STATUS','OVERDUE','Quá hạn',50,'ACTIVE'],
    [uuid_(),'TASK_STATUS','CANCELLED','Đã hủy',60,'ACTIVE'],

    [uuid_(),'PRIORITY','NORMAL','Bình thường',10,'ACTIVE'],
    [uuid_(),'PRIORITY','HIGH','Cao',20,'ACTIVE'],
    [uuid_(),'PRIORITY','URGENT','Khẩn',30,'ACTIVE'],

    [uuid_(),'DOCUMENT_DIRECTION','INCOMING','Văn bản đến',10,'ACTIVE'],
    [uuid_(),'DOCUMENT_DIRECTION','OUTGOING','Văn bản đi',20,'ACTIVE'],
    [uuid_(),'DOCUMENT_DIRECTION','DRAFT','Dự thảo',30,'ACTIVE'],

    [uuid_(),'CALENDAR_GROUP','GENERAL','Lịch chung',10,'ACTIVE'],
    [uuid_(),'CALENDAR_GROUP','SECRETARY','Bí thư',20,'ACTIVE'],
    [uuid_(),'CALENDAR_GROUP','DEPUTY_SECRETARY','Phó Bí thư',30,'ACTIVE'],
    [uuid_(),'CALENDAR_GROUP','OFFICE','Văn phòng',40,'ACTIVE']
  ];
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedDepartments_() {
  const sh = SystemConfig.getSheet('DEPARTMENTS');
  const now = new Date();
  const rows = [
    [uuid_(),'VP','Văn phòng Đảng ủy','','ACTIVE',now,now],
    [uuid_(),'LD','Lãnh đạo Đảng ủy','','ACTIVE',now,now],
    [uuid_(),'CM','Bộ phận chuyên môn','','ACTIVE',now,now]
  ];
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedAdminUser_() {
  const sh = SystemConfig.getSheet('USERS');
  const now = new Date();

  let email = Session.getEffectiveUser().getEmail();
  if (!email) email = 'admin@example.local';

  const departments = RepositoryService.getAll('DEPARTMENTS');
  const office = departments.find(x => x.department_code === 'VP');

  sh.appendRow([
    uuid_(),
    email,
    'Quản trị hệ thống',
    office ? office.department_id : '',
    'ADMIN',
    'ACTIVE',
    '',
    '',
    '',
    now,
    now
  ]);
}

function formatDatabase_() {
  const ss = SystemConfig.getDb();

  ss.getSheets().forEach(sh => {
    const maxCol = sh.getLastColumn();
    if (maxCol > 0) {
      sh.autoResizeColumns(1, maxCol);
      for (let c = 1; c <= maxCol; c++) {
        const width = Math.min(Math.max(sh.getColumnWidth(c), 110), 260);
        sh.setColumnWidth(c, width);
      }
    }

    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
        .setVerticalAlignment('middle');
    }
  });
}

/**
 * CHỈ dùng khi test và muốn tạo lại từ đầu.
 * Không gọi nếu đã có dữ liệu thật.
 */
function resetSystemForDevelopment() {
  const props = SystemConfig.props();
  props.deleteProperty(SystemConfig.PROP_DB_ID);
  props.deleteProperty(SystemConfig.PROP_ROOT_FOLDER_ID);
  props.deleteProperty(SystemConfig.PROP_INITIALIZED_AT);
  return {ok:true, message:'Đã xóa cấu hình liên kết. File Spreadsheet/Drive cũ KHÔNG bị xóa.'};
}

function uuid_() {
  return Utilities.getUuid();
}