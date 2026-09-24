const SystemConfig = (() => {
  const PROP_DB_ID = 'VPDU_DB_SPREADSHEET_ID';
  const PROP_ROOT_FOLDER_ID = 'VPDU_ROOT_FOLDER_ID';
  const PROP_INITIALIZED_AT = 'VPDU_INITIALIZED_AT';

  const SHEETS = {
    USERS: [
      'user_id','email','full_name','department_id','role','status',
      'phone','avatar_url','last_login_at','created_at','updated_at'
    ],
    DOCUMENTS: [
      'document_id','direction','document_no','document_type','title','summary',
      'issuer','issued_date','received_date','field','priority','status',
      'assignee_user_id','due_date','drive_file_id','drive_folder_id',
      'parent_document_id','notes','created_by','created_at','updated_at'
    ],
    TASKS: [
      'task_id','title','description','source_type','source_id','priority','status',
      'progress','assigner_user_id','owner_user_id','collaborator_ids',
      'start_date','due_date','completed_at','result_note','created_at','updated_at'
    ],
    TASK_HISTORY: [
      'history_id','task_id','action','from_status','to_status','from_progress',
      'to_progress','note','actor_user_id','created_at'
    ],
    MEETINGS: [
      'meeting_id','meeting_type','title','agenda','meeting_date','start_time',
      'end_time','location','chairperson','status','minutes_file_id',
      'conclusion_file_id','drive_folder_id','created_by','created_at','updated_at'
    ],
    MEETING_MEMBERS: [
      'id','meeting_id','user_id','display_name','organization','attendance_status','note'
    ],
    MEETING_TASKS: [
      'id','meeting_id','task_id','conclusion_item_no','created_at'
    ],
    CALENDAR: [
      'event_id','title','event_type','calendar_group','event_date','start_time',
      'end_time','location','description','meeting_id','task_id','created_by',
      'created_at','updated_at'
    ],
    DRAFTS: [
      'draft_id','draft_type','title','content_html','template_id','source_type',
      'source_id','status','version','drive_file_id','created_by','created_at','updated_at'
    ],
    TEMPLATES: [
      'template_id','template_type','template_name','description','drive_file_id',
      'status','created_by','created_at','updated_at'
    ],
    NOTIFICATIONS: [
      'notification_id','user_id','type','title','message','reference_type',
      'reference_id','is_read','created_at','read_at'
    ],
    ACTIVITY_LOG: [
      'log_id','user_id','action','entity_type','entity_id','detail_json',
      'ip_note','created_at'
    ],
    CATEGORIES: [
      'category_id','category_type','category_code','category_name','sort_order','status'
    ],
    DEPARTMENTS: [
      'department_id','department_code','department_name','parent_id','status',
      'created_at','updated_at'
    ],
    SETTINGS: [
      'setting_key','setting_value','description','updated_at'
    ]
  };

  const ROOT_FOLDER_NAME = 'VAN_PHONG_DANG_UY_SO';
  const DRIVE_FOLDERS = [
    {key:'INCOMING', name:'01_Van-ban-den'},
    {key:'OUTGOING', name:'02_Van-ban-di'},
    {key:'DRAFTS', name:'03_Du-thao'},
    {key:'MEETINGS', name:'04_Cuoc-hop'},
    {key:'REPORTS', name:'05_Bao-cao'},
    {key:'TEMPLATES', name:'06_Mau-van-ban'},
    {key:'REFERENCES', name:'07_Tai-lieu-tham-khao'},
    {key:'ATTACHMENTS', name:'08_Tep-dinh-kem'}
  ];

  function props() {
    return PropertiesService.getScriptProperties();
  }

  function getDbId() {
    return props().getProperty(PROP_DB_ID) || '';
  }

  function getRootFolderId() {
    return props().getProperty(PROP_ROOT_FOLDER_ID) || '';
  }

  function getDb() {
    const id = getDbId();
    if (!id) throw new Error('Hệ thống chưa được khởi tạo. Hãy chạy setupSystem() một lần.');
    return SpreadsheetApp.openById(id);
  }

  function getSheet(name) {
    const sh = getDb().getSheetByName(name);
    if (!sh) throw new Error('Không tìm thấy sheet: ' + name);
    return sh;
  }

  function getSystemInfo() {
    return {
      initialized: Boolean(getDbId() && getRootFolderId()),
      databaseId: getDbId(),
      rootFolderId: getRootFolderId(),
      initializedAt: props().getProperty(PROP_INITIALIZED_AT) || ''
    };
  }

  return {
    PROP_DB_ID, PROP_ROOT_FOLDER_ID, PROP_INITIALIZED_AT,
    SHEETS, ROOT_FOLDER_NAME, DRIVE_FOLDERS,
    props, getDbId, getRootFolderId, getDb, getSheet, getSystemInfo
  };
})();