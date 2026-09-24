const F1CompleteService = (() => {
  const TZ = 'Asia/Ho_Chi_Minh';
  const VERSION = 'FINAL-2026.09.24';

  const MEETING_FILES_SHEET = 'MEETING_FILES';
  const MEETING_FILES_HEADERS = [
    'id','meeting_id','drive_file_id','file_name','mime_type','size',
    'file_kind','uploaded_by','created_at'
  ];

  const REPO_META_SHEET = 'REPOSITORY_META';
  const REPO_META_HEADERS = [
    'id','item_id','item_type','is_favorite','created_by','updated_at'
  ];

  const VALID_MEETING_STATUS = ['PLANNED','IN_PROGRESS','COMPLETED','CANCELLED'];
  const VALID_CALENDAR_STATUS = ['ACTIVE','CANCELLED'];
  const PREP_CACHE_PREFIX = 'VPDU_F1_PREP_';
  const REPO_FAVORITE_CACHE_KEY = 'VPDU_F1_REPO_FAVORITES';

  function clean_(v) {
    return String(v == null ? '' : v).trim();
  }

  function me_() {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated) throw new Error(me.message || 'Chưa đăng nhập.');
    return me;
  }

  function hasPerm_(me, permission) {
    const perms = me.permissions || [];
    return perms.includes('*') || perms.includes(permission);
  }

  function requirePerm_(permission) {
    AuthService.requirePermission(permission);
  }

  function withLock_(fn) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) {
      throw new Error('Hệ thống đang có thao tác khác. Vui lòng thử lại sau vài giây.');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  function ensureSheet_(name, headers) {
    const ss = SystemConfig.getDb();
    let sh = ss.getSheetByName(name);
    if (sh) return sh;

    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length)
      .setFontWeight('bold')
      .setBackground('#991B1B')
      .setFontColor('#FFFFFF')
      .setHorizontalAlignment('center');
    sh.setRowHeight(1,34);
    sh.autoResizeColumns(1,headers.length);
    return sh;
  }

  function ensureColumns_(sheetName, columns) {
    const sh = SystemConfig.getSheet(sheetName);
    const lastCol = sh.getLastColumn();
    const headers = lastCol
      ? sh.getRange(1,1,1,lastCol).getValues()[0]
      : [];

    columns.forEach(col => {
      if (!headers.includes(col)) {
        const next = sh.getLastColumn() + 1;
        sh.getRange(1,next).setValue(col);
        sh.getRange(1,next)
          .setFontWeight('bold')
          .setBackground('#991B1B')
          .setFontColor('#FFFFFF');
        headers.push(col);
      }
    });
  }

  function prepareOnce_(key, fn) {
    const cache = CacheService.getScriptCache();
    const cacheKey = PREP_CACHE_PREFIX + key;
    try {
      if (cache.get(cacheKey)) return;
    } catch (e) {}

    fn();
    try { cache.put(cacheKey,'1',21600); } catch (e) {}
  }

  function activeUsers_() {
    return AuthService.listActiveUsersCached();
  }

  function userMap_() {
    const map = {};
    AuthService.listUsersCached().forEach(u => {
      map[u.user_id] = {
        user_id:u.user_id,
        full_name:u.full_name || u.email || u.user_id,
        email:u.email || '',
        department_id:u.department_id || '',
        role:u.role || '',
        status:u.status || ''
      };
    });
    return map;
  }

  function normalizeDateKey_(v) {
    if (!v) return '';
    const d = new Date(v);
    if (!isNaN(d)) return Utilities.formatDate(d,TZ,'yyyy-MM-dd');
    return String(v).slice(0,10);
  }

  function nowIso_() {
    return new Date();
  }

  function validateTimeRange_(startTime,endTime) {
    if (!startTime || !endTime) return;
    if (String(endTime) <= String(startTime)) {
      throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
    }
  }

  // =========================
  // CALENDAR
  // =========================
  function prepareCalendar_() {
    prepareOnce_('CALENDAR_V1',() => {
      ensureColumns_('CALENDAR',['status','updated_by']);
    });
  }

  function calendarList(filters) {
    requirePerm_('calendar.view');
    prepareCalendar_();

    filters = filters || {};
    const from = clean_(filters.from);
    const to = clean_(filters.to);
    const includeCancelled = Boolean(filters.includeCancelled);

    let rows = RepositoryService.getAll('CALENDAR');
    rows = rows.filter(x => includeCancelled || !x.status || x.status === 'ACTIVE');

    if (from) rows = rows.filter(x => normalizeDateKey_(x.event_date) >= from);
    if (to) rows = rows.filter(x => normalizeDateKey_(x.event_date) <= to);

    rows.sort((a,b) => {
      const aa = normalizeDateKey_(a.event_date) + 'T' + (a.start_time || '00:00');
      const bb = normalizeDateKey_(b.event_date) + 'T' + (b.start_time || '00:00');
      return aa.localeCompare(bb);
    });

    return {
      ok:true,
      items:rows,
      server_ms:0
    };
  }

  function createCalendarInternal_(payload, actor, skipLog) {
    payload = payload || {};
    const title = clean_(payload.title);
    const eventDate = clean_(payload.event_date);

    if (!title) throw new Error('Tên lịch công tác không được để trống.');
    if (!eventDate) throw new Error('Bạn chưa chọn ngày.');
    validateTimeRange_(payload.start_time,payload.end_time);

    const now = nowIso_();
    const data = {
      event_id:uuid_(),
      title,
      event_type:clean_(payload.event_type || 'WORK').toUpperCase(),
      calendar_group:clean_(payload.calendar_group || 'GENERAL').toUpperCase(),
      event_date:eventDate,
      start_time:clean_(payload.start_time),
      end_time:clean_(payload.end_time),
      location:clean_(payload.location),
      description:clean_(payload.description),
      meeting_id:clean_(payload.meeting_id),
      task_id:clean_(payload.task_id),
      created_by:actor.userId,
      created_at:now,
      updated_at:now,
      status:'ACTIVE',
      updated_by:actor.userId
    };

    RepositoryService.append('CALENDAR',data);
    if (!skipLog) {
      ActivityService.log('CREATE','CALENDAR',data.event_id,{
        title:data.title,
        event_date:data.event_date
      });
    }
    return data;
  }

  function createCalendar(payload) {
    requirePerm_('calendar.create');
    prepareCalendar_();
    const me = me_();
    return withLock_(() => createCalendarInternal_(payload,me,false));
  }

  function updateCalendar(eventId,payload) {
    requirePerm_('calendar.update');
    prepareCalendar_();
    payload = payload || {};
    const me = me_();

    return withLock_(() => {
      const current = RepositoryService.findById('CALENDAR','event_id',eventId);
      if (!current) throw new Error('Không tìm thấy lịch công tác.');
      if (current.meeting_id) {
        throw new Error('Lịch này được đồng bộ từ cuộc họp. Hãy cập nhật trong hồ sơ Cuộc họp.');
      }

      const title = clean_(payload.title !== undefined ? payload.title : current.title);
      const eventDate = clean_(payload.event_date !== undefined ? payload.event_date : current.event_date);
      const startTime = clean_(payload.start_time !== undefined ? payload.start_time : current.start_time);
      const endTime = clean_(payload.end_time !== undefined ? payload.end_time : current.end_time);

      if (!title) throw new Error('Tên lịch công tác không được để trống.');
      if (!eventDate) throw new Error('Bạn chưa chọn ngày.');
      validateTimeRange_(startTime,endTime);

      const updated = RepositoryService.updateById('CALENDAR','event_id',eventId,{
        title,
        event_type:clean_(payload.event_type !== undefined ? payload.event_type : current.event_type).toUpperCase(),
        calendar_group:clean_(payload.calendar_group !== undefined ? payload.calendar_group : current.calendar_group).toUpperCase(),
        event_date:eventDate,
        start_time:startTime,
        end_time:endTime,
        location:clean_(payload.location !== undefined ? payload.location : current.location),
        description:clean_(payload.description !== undefined ? payload.description : current.description),
        updated_at:new Date(),
        updated_by:me.userId
      });

      ActivityService.log('UPDATE','CALENDAR',eventId,{
        title:updated.title,
        event_date:updated.event_date
      });
      return updated;
    });
  }

  function cancelCalendar(eventId) {
    requirePerm_('calendar.update');
    prepareCalendar_();
    const me = me_();

    return withLock_(() => {
      const current = RepositoryService.findById('CALENDAR','event_id',eventId);
      if (!current) throw new Error('Không tìm thấy lịch công tác.');
      if (current.meeting_id) {
        throw new Error('Lịch này được đồng bộ từ cuộc họp. Hãy hủy hoặc cập nhật trong hồ sơ Cuộc họp.');
      }
      const updated = RepositoryService.updateById('CALENDAR','event_id',eventId,{
        status:'CANCELLED',
        updated_at:new Date(),
        updated_by:me.userId
      });
      ActivityService.log('CANCEL','CALENDAR',eventId,{title:current.title});
      return updated;
    });
  }

  // =========================
  // MEETINGS
  // =========================
  function prepareMeetings_() {
    prepareOnce_('MEETINGS_V1',() => {
      ensureColumns_('MEETINGS',['minutes_text','conclusion_text','updated_by']);
      ensureSheet_(MEETING_FILES_SHEET,MEETING_FILES_HEADERS);
    });
  }

  function normalizeMeetingStatus_(v) {
    const s = clean_(v || 'PLANNED').toUpperCase();
    if (!VALID_MEETING_STATUS.includes(s)) {
      throw new Error('Trạng thái cuộc họp không hợp lệ.');
    }
    return s;
  }

  function meetingFolder_(meeting) {
    if (meeting.drive_folder_id) {
      try {
        return DriveApp.getFolderById(meeting.drive_folder_id);
      } catch (e) {}
    }

    const folder = DriveService.createMeetingFolder(
      meeting.meeting_id,
      meeting.title,
      meeting.meeting_date
    );
    RepositoryService.updateById('MEETINGS','meeting_id',meeting.meeting_id,{
      drive_folder_id:folder.folderId,
      updated_at:new Date()
    });
    return DriveApp.getFolderById(folder.folderId);
  }

  function membersForMeeting_(meetingId, allMembers) {
    return allMembers.filter(x => x.meeting_id === meetingId);
  }

  function filesForMeeting_(meetingId, allFiles, users) {
    return allFiles
      .filter(x => x.meeting_id === meetingId)
      .map(x => ({
        ...x,
        size:Number(x.size || 0),
        uploader_name:users[x.uploaded_by]?.full_name || '',
        url:x.drive_file_id ? ('https://drive.google.com/open?id=' + x.drive_file_id) : ''
      }))
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  function meetingList(filters) {
    requirePerm_('meetings.view');
    prepareMeetings_();
    filters = filters || {};

    const q = clean_(filters.q).toLowerCase();
    const status = clean_(filters.status || 'ALL').toUpperCase();
    const members = RepositoryService.getAll('MEETING_MEMBERS');
    const files = RepositoryService.getAll(MEETING_FILES_SHEET);
    const links = RepositoryService.getAll('MEETING_TASKS');

    let meetings = RepositoryService.getAll('MEETINGS').map(m => ({
      ...m,
      member_count:members.filter(x => x.meeting_id === m.meeting_id).length,
      file_count:files.filter(x => x.meeting_id === m.meeting_id).length,
      task_count:links.filter(x => x.meeting_id === m.meeting_id).length,
      folder_url:m.drive_folder_id
        ? ('https://drive.google.com/drive/folders/' + m.drive_folder_id)
        : ''
    }));

    if (status !== 'ALL') meetings = meetings.filter(m => m.status === status);
    if (q) {
      meetings = meetings.filter(m =>
        [m.title,m.agenda,m.location,m.chairperson,m.meeting_type]
          .some(v => String(v || '').toLowerCase().includes(q))
      );
    }

    meetings.sort((a,b) => {
      const aa = normalizeDateKey_(a.meeting_date) + 'T' + (a.start_time || '00:00');
      const bb = normalizeDateKey_(b.meeting_date) + 'T' + (b.start_time || '00:00');
      return aa.localeCompare(bb);
    });

    return {ok:true,items:meetings};
  }

  function meetingGet(meetingId) {
    requirePerm_('meetings.view');
    prepareMeetings_();

    const users = userMap_();
    const meeting = RepositoryService.findById('MEETINGS','meeting_id',meetingId);
    if (!meeting) throw new Error('Không tìm thấy cuộc họp.');

    const members = membersForMeeting_(
      meetingId,
      RepositoryService.getAll('MEETING_MEMBERS')
    ).map(x => ({
      ...x,
      user_name:users[x.user_id]?.full_name || x.display_name || ''
    }));

    const files = filesForMeeting_(
      meetingId,
      RepositoryService.getAll(MEETING_FILES_SHEET),
      users
    );

    // Tương thích các hồ sơ B3 cũ: attachment từng được lưu trực tiếp
    // ở minutes_file_id / conclusion_file_id trước khi có MEETING_FILES.
    const knownFileIds = new Set(files.map(x => x.drive_file_id));
    [
      {id:meeting.minutes_file_id,kind:'MINUTES'},
      {id:meeting.conclusion_file_id,kind:'CONCLUSION'}
    ].forEach(legacy => {
      if (!legacy.id || knownFileIds.has(legacy.id)) return;
      try {
        const file = DriveApp.getFileById(legacy.id);
        files.push({
          id:'legacy_' + legacy.id,
          meeting_id:meetingId,
          drive_file_id:legacy.id,
          file_name:file.getName(),
          mime_type:file.getMimeType(),
          size:file.getSize(),
          file_kind:legacy.kind,
          uploaded_by:meeting.created_by || '',
          uploader_name:users[meeting.created_by]?.full_name || '',
          created_at:meeting.created_at || '',
          url:file.getUrl(),
          legacy:true
        });
      } catch (e) {}
    });

    const relationIds = new Set(
      RepositoryService.getAll('MEETING_TASKS')
        .filter(x => x.meeting_id === meetingId)
        .map(x => x.task_id)
    );

    const tasks = RepositoryService.getAll('TASKS')
      .filter(t =>
        relationIds.has(t.task_id) ||
        (t.source_type === 'MEETING' && t.source_id === meetingId)
      )
      .map(t => ({
        ...t,
        owner_name:users[t.owner_user_id]?.full_name || '',
        progress:Number(t.progress || 0)
      }));

    const me = me_();
    return {
      ok:true,
      meeting:{
        ...meeting,
        folder_url:meeting.drive_folder_id
          ? ('https://drive.google.com/drive/folders/' + meeting.drive_folder_id)
          : ''
      },
      members,
      files,
      tasks,
      permissions:{
        canEdit:hasPerm_(me,'meetings.update'),
        canCreateTask:hasPerm_(me,'tasks.create')
      }
    };
  }

  function replaceMeetingMembers_(meetingId,members) {
    RepositoryService.deleteWhere('MEETING_MEMBERS',x => x.meeting_id === meetingId);

    (Array.isArray(members) ? members : []).forEach(m => {
      const userId = clean_(m.user_id);
      const savedUser = userId
        ? AuthService.listUsersCached().find(u => u.user_id === userId)
        : null;
      RepositoryService.append('MEETING_MEMBERS',{
        id:uuid_(),
        meeting_id:meetingId,
        user_id:userId,
        display_name:clean_(m.display_name || savedUser?.full_name || savedUser?.email),
        organization:clean_(m.organization),
        attendance_status:clean_(m.attendance_status || 'INVITED').toUpperCase(),
        note:clean_(m.note)
      });
    });
  }

  function syncMeetingCalendar_(meeting) {
    prepareCalendar_();
    const all = RepositoryService.getAll('CALENDAR');
    const event = all.find(x => x.meeting_id === meeting.meeting_id);

    const payload = {
      title:meeting.title,
      event_type:'MEETING',
      calendar_group:'GENERAL',
      event_date:meeting.meeting_date,
      start_time:meeting.start_time,
      end_time:meeting.end_time,
      location:meeting.location,
      description:meeting.agenda,
      meeting_id:meeting.meeting_id
    };

    if (event) {
      RepositoryService.updateById('CALENDAR','event_id',event.event_id,{
        ...payload,
        status:meeting.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
        updated_at:new Date()
      });
    } else if (meeting.status !== 'CANCELLED') {
      createCalendarInternal_(payload,me_(),true);
    }
  }

  function createMeeting(payload) {
    requirePerm_('meetings.create');
    prepareMeetings_();
    prepareCalendar_();
    payload = payload || {};
    const me = me_();

    return withLock_(() => {
      const title = clean_(payload.title);
      const date = clean_(payload.meeting_date);
      if (!title) throw new Error('Tên cuộc họp không được để trống.');
      if (!date) throw new Error('Bạn chưa chọn ngày họp.');
      validateTimeRange_(payload.start_time,payload.end_time);

      const now = new Date();
      const data = {
        meeting_id:uuid_(),
        meeting_type:clean_(payload.meeting_type || 'Khác'),
        title,
        agenda:clean_(payload.agenda),
        meeting_date:date,
        start_time:clean_(payload.start_time),
        end_time:clean_(payload.end_time),
        location:clean_(payload.location),
        chairperson:clean_(payload.chairperson),
        status:normalizeMeetingStatus_(payload.status || 'PLANNED'),
        minutes_file_id:'',
        conclusion_file_id:'',
        drive_folder_id:'',
        created_by:me.userId,
        created_at:now,
        updated_at:now,
        minutes_text:'',
        conclusion_text:'',
        updated_by:me.userId
      };

      RepositoryService.append('MEETINGS',data);
      replaceMeetingMembers_(data.meeting_id,payload.members || []);
      syncMeetingCalendar_(data);

      ActivityService.log('CREATE','MEETING',data.meeting_id,{
        title:data.title,
        meeting_date:data.meeting_date
      });

      return {ok:true,meeting_id:data.meeting_id};
    });
  }

  function updateMeeting(meetingId,payload) {
    requirePerm_('meetings.update');
    prepareMeetings_();
    payload = payload || {};
    const me = me_();

    return withLock_(() => {
      const current = RepositoryService.findById('MEETINGS','meeting_id',meetingId);
      if (!current) throw new Error('Không tìm thấy cuộc họp.');

      const title = clean_(payload.title !== undefined ? payload.title : current.title);
      const date = clean_(payload.meeting_date !== undefined ? payload.meeting_date : current.meeting_date);
      const start = clean_(payload.start_time !== undefined ? payload.start_time : current.start_time);
      const end = clean_(payload.end_time !== undefined ? payload.end_time : current.end_time);

      if (!title) throw new Error('Tên cuộc họp không được để trống.');
      if (!date) throw new Error('Bạn chưa chọn ngày họp.');
      validateTimeRange_(start,end);

      const updated = RepositoryService.updateById('MEETINGS','meeting_id',meetingId,{
        meeting_type:clean_(payload.meeting_type !== undefined ? payload.meeting_type : current.meeting_type),
        title,
        agenda:clean_(payload.agenda !== undefined ? payload.agenda : current.agenda),
        meeting_date:date,
        start_time:start,
        end_time:end,
        location:clean_(payload.location !== undefined ? payload.location : current.location),
        chairperson:clean_(payload.chairperson !== undefined ? payload.chairperson : current.chairperson),
        status:normalizeMeetingStatus_(payload.status || current.status),
        updated_at:new Date(),
        updated_by:me.userId
      });

      if (payload.members !== undefined) {
        replaceMeetingMembers_(meetingId,payload.members);
      }
      syncMeetingCalendar_(updated);

      ActivityService.log('UPDATE','MEETING',meetingId,{
        title:updated.title,
        meeting_date:updated.meeting_date,
        status:updated.status
      });

      return {ok:true,meeting_id:meetingId};
    });
  }

  function saveMeetingNotes(meetingId,payload) {
    requirePerm_('meetings.update');
    prepareMeetings_();
    payload = payload || {};
    const me = me_();

    return withLock_(() => {
      const current = RepositoryService.findById('MEETINGS','meeting_id',meetingId);
      if (!current) throw new Error('Không tìm thấy cuộc họp.');

      const patch = {
        updated_at:new Date(),
        updated_by:me.userId
      };
      if (payload.agenda !== undefined) patch.agenda = clean_(payload.agenda);
      if (payload.minutes_text !== undefined) patch.minutes_text = clean_(payload.minutes_text);
      if (payload.conclusion_text !== undefined) patch.conclusion_text = clean_(payload.conclusion_text);
      if (payload.status !== undefined) patch.status = normalizeMeetingStatus_(payload.status);

      const updated = RepositoryService.updateById('MEETINGS','meeting_id',meetingId,patch);
      syncMeetingCalendar_(updated);
      ActivityService.log('UPDATE_AGENDA','MEETING',meetingId,{status:updated.status});
      return {ok:true,meeting_id:meetingId};
    });
  }

  function addMeetingFile(meetingId,file,kind) {
    requirePerm_('meetings.update');
    prepareMeetings_();

    if (!file || !file.name || !file.base64) throw new Error('Bạn chưa chọn tệp.');
    if (file.size && Number(file.size) > 20*1024*1024) {
      throw new Error('Mỗi tệp tối đa 20 MB.');
    }

    kind = clean_(kind || 'MATERIAL').toUpperCase();
    if (!['MATERIAL','MINUTES','CONCLUSION'].includes(kind)) kind = 'MATERIAL';

    const me = me_();
    return withLock_(() => {
      const meeting = RepositoryService.findById('MEETINGS','meeting_id',meetingId);
      if (!meeting) throw new Error('Không tìm thấy cuộc họp.');

      const folder = meetingFolder_(meeting);
      const saved = DriveService.saveBase64FileToFolder(file,folder.getId());
      const row = {
        id:uuid_(),
        meeting_id:meetingId,
        drive_file_id:saved.fileId,
        file_name:saved.name,
        mime_type:saved.mimeType,
        size:saved.size,
        file_kind:kind,
        uploaded_by:me.userId,
        created_at:new Date()
      };
      RepositoryService.append(MEETING_FILES_SHEET,row);

      const patch = {
        drive_folder_id:folder.getId(),
        updated_at:new Date(),
        updated_by:me.userId
      };
      if (kind === 'MINUTES') patch.minutes_file_id = saved.fileId;
      if (kind === 'CONCLUSION') patch.conclusion_file_id = saved.fileId;
      RepositoryService.updateById('MEETINGS','meeting_id',meetingId,patch);

      ActivityService.log('UPLOAD_FILE','MEETING',meetingId,{
        fileName:saved.name,
        fileKind:kind
      });

      return {ok:true,file:row};
    });
  }

  // =========================
  // REPOSITORY
  // =========================
  function prepareRepo_() {
    prepareOnce_('REPOSITORY_V1',() => {
      ensureSheet_(REPO_META_SHEET,REPO_META_HEADERS);
    });
  }

  function rootId_() {
    const id = SystemConfig.getRootFolderId();
    if (!id) throw new Error('Chưa có thư mục gốc của hệ thống.');
    return id;
  }

  function folderInsideRoot_(folderId) {
    const root = rootId_();
    if (folderId === root) return true;
    let folder = DriveApp.getFolderById(folderId);
    for (let i=0;i<20;i++) {
      const parents = folder.getParents();
      if (!parents.hasNext()) return false;
      const p = parents.next();
      if (p.getId() === root) return true;
      folder = p;
    }
    return false;
  }

  function fileInsideRoot_(fileId) {
    const f = DriveApp.getFileById(fileId);
    const parents = f.getParents();
    while (parents.hasNext()) {
      if (folderInsideRoot_(parents.next().getId())) return true;
    }
    return false;
  }

  function safeFolder_(id) {
    const target = id || rootId_();
    if (!folderInsideRoot_(target)) throw new Error('Thư mục không thuộc kho hồ sơ số.');
    return DriveApp.getFolderById(target);
  }

  function favoriteMap_() {
    prepareRepo_();
    const cache = CacheService.getScriptCache();
    try {
      const hit = cache.get(REPO_FAVORITE_CACHE_KEY);
      if (hit) return JSON.parse(hit);
    } catch (e) {}

    const map = {};
    RepositoryService.getAll(REPO_META_SHEET).forEach(x => {
      map[x.item_id] = String(x.is_favorite).toUpperCase() === 'TRUE' || x.is_favorite === true;
    });

    try { cache.put(REPO_FAVORITE_CACHE_KEY,JSON.stringify(map),60); } catch (e) {}
    return map;
  }

  function clearFavoriteCache_() {
    try { CacheService.getScriptCache().remove(REPO_FAVORITE_CACHE_KEY); } catch (e) {}
  }

  function folderItem_(f,favs) {
    return {
      id:f.getId(),
      name:f.getName(),
      type:'folder',
      url:f.getUrl(),
      favorite:Boolean(favs?.[f.getId()])
    };
  }

  function fileItem_(f,favs) {
    return {
      id:f.getId(),
      name:f.getName(),
      type:'file',
      mimeType:f.getMimeType(),
      size:f.getSize(),
      updatedAt:f.getLastUpdated().toISOString(),
      url:f.getUrl(),
      favorite:Boolean(favs?.[f.getId()])
    };
  }

  function repositoryList(folderId) {
    requirePerm_('repository.view');
    prepareRepo_();

    const folder = safeFolder_(folderId);
    const favs = favoriteMap_();
    const folders = [];
    const files = [];

    const fit = folder.getFolders();
    while (fit.hasNext()) folders.push(folderItem_(fit.next(),favs));

    const it = folder.getFiles();
    while (it.hasNext()) files.push(fileItem_(it.next(),favs));

    folders.sort((a,b) => a.name.localeCompare(b.name,'vi'));
    files.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    let parentId = '';
    if (folder.getId() !== rootId_()) {
      const parents = folder.getParents();
      if (parents.hasNext()) {
        const p = parents.next();
        if (folderInsideRoot_(p.getId())) parentId = p.getId();
      }
    }

    return {
      ok:true,
      folder:folderItem_(folder,favs),
      rootFolderId:rootId_(),
      parentId,
      folders,
      files,
      counts:{folders:folders.length,files:files.length}
    };
  }

  function repositoryCreateFolder(parentId,name) {
    requirePerm_('repository.upload');
    const me = me_();
    const cleanName = clean_(name);
    if (!cleanName) throw new Error('Tên thư mục không được để trống.');
    if (cleanName.length > 100) throw new Error('Tên thư mục quá dài.');

    return withLock_(() => {
      const parent = safeFolder_(parentId);
      const same = parent.getFoldersByName(cleanName);
      if (same.hasNext()) throw new Error('Đã tồn tại thư mục cùng tên.');

      const folder = parent.createFolder(cleanName);
      ActivityService.log('CREATE_FOLDER','REPOSITORY',folder.getId(),{
        name:cleanName,
        parentId:parent.getId(),
        createdBy:me.userId
      });
      return folderItem_(folder,{});
    });
  }

  function repositoryUpload(parentId,file) {
    requirePerm_('repository.upload');
    if (!file || !file.base64 || !file.name) throw new Error('Bạn chưa chọn tệp.');
    if (file.size && Number(file.size) > 20*1024*1024) {
      throw new Error('Mỗi tệp tối đa 20 MB.');
    }

    const parent = safeFolder_(parentId);
    const saved = DriveService.saveBase64FileToFolder(file,parent.getId());
    ActivityService.log('UPLOAD_FILE','REPOSITORY',saved.fileId,{
      name:saved.name,
      folderId:parent.getId()
    });
    return saved;
  }

  function repositoryRename(itemType,itemId,name) {
    requirePerm_('repository.upload');
    const cleanName = clean_(name);
    if (!cleanName) throw new Error('Tên mới không được để trống.');
    if (cleanName.length > 120) throw new Error('Tên quá dài.');

    return withLock_(() => {
      if (itemType === 'folder') {
        if (itemId === rootId_()) throw new Error('Không thể đổi tên thư mục gốc.');
        if (!folderInsideRoot_(itemId)) throw new Error('Thư mục không hợp lệ.');
        DriveApp.getFolderById(itemId).setName(cleanName);
      } else {
        if (!fileInsideRoot_(itemId)) throw new Error('Tệp không hợp lệ.');
        DriveApp.getFileById(itemId).setName(cleanName);
      }
      ActivityService.log('RENAME','REPOSITORY',itemId,{name:cleanName});
      return {ok:true};
    });
  }

  function repositoryTrash(itemType,itemId) {
    requirePerm_('repository.upload');
    return withLock_(() => {
      if (itemType === 'folder') {
        if (itemId === rootId_()) throw new Error('Không thể xóa thư mục gốc.');
        if (!folderInsideRoot_(itemId)) throw new Error('Thư mục không hợp lệ.');
        DriveApp.getFolderById(itemId).setTrashed(true);
      } else {
        if (!fileInsideRoot_(itemId)) throw new Error('Tệp không hợp lệ.');
        DriveApp.getFileById(itemId).setTrashed(true);
      }
      ActivityService.log('TRASH','REPOSITORY',itemId,{itemType});
      return {ok:true};
    });
  }

  function repositoryFavorite(itemType,itemId,value) {
    requirePerm_('repository.view');
    prepareRepo_();
    const me = me_();

    itemType = clean_(itemType).toLowerCase();
    if (itemType === 'folder') {
      if (!folderInsideRoot_(itemId)) throw new Error('Thư mục không hợp lệ.');
    } else if (itemType === 'file') {
      if (!fileInsideRoot_(itemId)) throw new Error('Tệp không hợp lệ.');
    } else {
      throw new Error('Loại tài liệu không hợp lệ.');
    }

    const rows = RepositoryService.getAll(REPO_META_SHEET);
    const existing = rows.find(x => x.item_id === itemId);
    const patch = {
      item_type:itemType,
      is_favorite:Boolean(value),
      created_by:existing?.created_by || me.userId,
      updated_at:new Date()
    };

    if (existing) {
      RepositoryService.updateById(REPO_META_SHEET,'id',existing.id,patch);
    } else {
      RepositoryService.append(REPO_META_SHEET,{
        id:uuid_(),
        item_id:itemId,
        ...patch
      });
    }
    clearFavoriteCache_();
    return {ok:true,favorite:Boolean(value)};
  }

  function scanRepo_(folder,query,results,depth,favs,recentOnly) {
    if (depth > 7 || results.length >= 120) return;

    const fit = folder.getFolders();
    while (fit.hasNext() && results.length < 120) {
      const child = fit.next();
      if (!query || child.getName().toLowerCase().includes(query)) {
        if (!recentOnly) results.push(folderItem_(child,favs));
      }
      scanRepo_(child,query,results,depth+1,favs,recentOnly);
    }

    const files = folder.getFiles();
    while (files.hasNext() && results.length < 120) {
      const file = files.next();
      if (!query || file.getName().toLowerCase().includes(query)) {
        results.push(fileItem_(file,favs));
      }
    }
  }

  function repositorySearch(query) {
    requirePerm_('repository.view');
    const q = clean_(query).toLowerCase();
    if (!q) return [];
    const favs = favoriteMap_();
    const results = [];
    scanRepo_(DriveApp.getFolderById(rootId_()),q,results,0,favs,false);
    return results.slice(0,100);
  }

  function repositoryRecent() {
    requirePerm_('repository.view');
    const favs = favoriteMap_();
    const results = [];
    scanRepo_(DriveApp.getFolderById(rootId_()),'',results,0,favs,true);
    return results
      .filter(x => x.type === 'file')
      .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0,40);
  }

  function repositoryFavorites() {
    requirePerm_('repository.view');
    prepareRepo_();
    const rows = RepositoryService.getAll(REPO_META_SHEET)
      .filter(x => String(x.is_favorite).toUpperCase() === 'TRUE' || x.is_favorite === true);

    const result = [];
    rows.forEach(x => {
      try {
        if (x.item_type === 'folder' && folderInsideRoot_(x.item_id)) {
          result.push(folderItem_(DriveApp.getFolderById(x.item_id),{[x.item_id]:true}));
        } else if (x.item_type === 'file' && fileInsideRoot_(x.item_id)) {
          result.push(fileItem_(DriveApp.getFileById(x.item_id),{[x.item_id]:true}));
        }
      } catch (e) {}
    });
    return result;
  }

  // =========================
  // REPORTS
  // =========================
  function dateRange_(filters) {
    filters = filters || {};
    const period = clean_(filters.period || 'MONTH').toUpperCase();
    const anchor = filters.anchorDate ? new Date(filters.anchorDate) : new Date();
    if (isNaN(anchor)) throw new Error('Ngày báo cáo không hợp lệ.');

    let from;
    let to;

    if (period === 'WEEK') {
      const day = anchor.getDay() || 7;
      from = new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()-(day-1));
      to = new Date(from.getFullYear(),from.getMonth(),from.getDate()+6,23,59,59,999);
    } else if (period === 'QUARTER') {
      const q = Math.floor(anchor.getMonth()/3);
      from = new Date(anchor.getFullYear(),q*3,1);
      to = new Date(anchor.getFullYear(),q*3+3,0,23,59,59,999);
    } else if (period === 'CUSTOM') {
      from = new Date(filters.dateFrom);
      to = new Date(filters.dateTo);
      if (isNaN(from) || isNaN(to)) throw new Error('Khoảng thời gian tùy chỉnh không hợp lệ.');
      to.setHours(23,59,59,999);
    } else {
      from = new Date(anchor.getFullYear(),anchor.getMonth(),1);
      to = new Date(anchor.getFullYear(),anchor.getMonth()+1,0,23,59,59,999);
    }

    return {period,from,to};
  }

  function reportData(filters) {
    requirePerm_('reports.view');
    filters = filters || {};
    const range = dateRange_(filters);
    const users = userMap_();
    const dept = clean_(filters.departmentId || 'ALL');

    const taskDate = t => new Date(t.created_at || t.start_date || t.due_date || 0);
    const docDate = d => new Date(d.received_date || d.issued_date || d.created_at || 0);

    const allTasks = RepositoryService.getAll('TASKS');
    let tasks = allTasks
      .filter(t => {
        const d = taskDate(t);
        return !isNaN(d) && d >= range.from && d <= range.to;
      });

    let docs = RepositoryService.getAll('DOCUMENTS')
      .filter(d => {
        const dt = docDate(d);
        return !isNaN(dt) && dt >= range.from && dt <= range.to;
      });

    if (dept !== 'ALL') {
      tasks = tasks.filter(t => users[t.owner_user_id]?.department_id === dept);
      docs = docs.filter(d => users[d.assignee_user_id]?.department_id === dept);
    }

    const now = new Date();
    const effective = t => {
      if (
        t.due_date &&
        !['COMPLETED','CANCELLED'].includes(t.status) &&
        new Date(t.due_date) < now
      ) return 'OVERDUE';
      return t.status || 'NEW';
    };

    const enrichedTasks = tasks.map(t => ({
      ...t,
      effective_status:effective(t),
      owner_name:users[t.owner_user_id]?.full_name || ''
    }));

    const stats = {
      totalTasks:enrichedTasks.length,
      completed:enrichedTasks.filter(t => t.status === 'COMPLETED').length,
      inProgress:enrichedTasks.filter(t => t.effective_status === 'IN_PROGRESS').length,
      waitingApproval:enrichedTasks.filter(t => t.effective_status === 'WAITING_APPROVAL').length,
      newCount:enrichedTasks.filter(t => t.effective_status === 'NEW').length,
      overdue:enrichedTasks.filter(t => t.effective_status === 'OVERDUE').length,
      cancelled:enrichedTasks.filter(t => t.status === 'CANCELLED').length,
      totalDocuments:docs.length,
      incomingDocuments:docs.filter(d => d.direction === 'INCOMING').length,
      outgoingDocuments:docs.filter(d => d.direction === 'OUTGOING').length
    };

    const months = [];
    for (let i=5;i>=0;i--) {
      const d = new Date(range.to.getFullYear(),range.to.getMonth()-i,1);
      const key = Utilities.formatDate(d,TZ,'yyyy-MM');
      const mt = allTasks.filter(t => {
        const dt = taskDate(t);
        const inMonth = !isNaN(dt) && Utilities.formatDate(dt,TZ,'yyyy-MM') === key;
        const inDepartment = dept === 'ALL' || users[t.owner_user_id]?.department_id === dept;
        return inMonth && inDepartment;
      });
      months.push({
        key,
        label:'T'+(d.getMonth()+1),
        completed:mt.filter(t => t.status === 'COMPLETED').length,
        processing:mt.filter(t => ['NEW','IN_PROGRESS','WAITING_APPROVAL'].includes(effective(t))).length,
        overdue:mt.filter(t => effective(t) === 'OVERDUE').length
      });
    }

    const attention = enrichedTasks
      .filter(t => !['COMPLETED','CANCELLED'].includes(t.status))
      .sort((a,b) => {
        const aa = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const bb = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        return aa-bb;
      })
      .slice(0,10);

    const departments = RepositoryService.getAll('DEPARTMENTS')
      .filter(x => x.status === 'ACTIVE')
      .map(x => ({
        id:x.department_id,
        name:x.department_name
      }));

    return {
      ok:true,
      generatedAt:new Date().toISOString(),
      range:{
        period:range.period,
        from:range.from.toISOString(),
        to:range.to.toISOString()
      },
      stats,
      months,
      attention,
      departments
    };
  }

  function exportReportPdf(filters) {
    requirePerm_('reports.create');
    const data = reportData(filters);
    const me = me_();
    const fromText = Utilities.formatDate(new Date(data.range.from),TZ,'dd/MM/yyyy');
    const toText = Utilities.formatDate(new Date(data.range.to),TZ,'dd/MM/yyyy');
    const title = 'Bao-cao-dieu-hanh_' +
      Utilities.formatDate(new Date(),TZ,'yyyyMMdd_HHmm');

    const doc = DocumentApp.create(title);
    const body = doc.getBody();

    body.appendParagraph('BÁO CÁO ĐIỀU HÀNH')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('Thời gian: ' + fromText + ' - ' + toText);
    body.appendParagraph('Người tạo: ' + (me.fullName || me.email || ''));

    body.appendParagraph('1. Tình hình nhiệm vụ')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendTable([
      ['Chỉ tiêu','Số lượng'],
      ['Tổng nhiệm vụ',String(data.stats.totalTasks)],
      ['Hoàn thành',String(data.stats.completed)],
      ['Đang thực hiện',String(data.stats.inProgress)],
      ['Chờ duyệt',String(data.stats.waitingApproval)],
      ['Quá hạn',String(data.stats.overdue)]
    ]);

    body.appendParagraph('2. Tình hình văn bản')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendTable([
      ['Chỉ tiêu','Số lượng'],
      ['Tổng văn bản',String(data.stats.totalDocuments)],
      ['Văn bản đến',String(data.stats.incomingDocuments)],
      ['Văn bản đi',String(data.stats.outgoingDocuments)]
    ]);

    body.appendParagraph('3. Nhiệm vụ cần chú ý')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (!data.attention.length) {
      body.appendParagraph('Không có nhiệm vụ cần chú ý trong kỳ.');
    } else {
      data.attention.forEach((t,i) => {
        body.appendListItem(
          (i+1) + '. ' + t.title +
          ' — ' + (t.owner_name || 'Chưa giao') +
          (t.due_date ? ' — hạn ' + Utilities.formatDate(new Date(t.due_date),TZ,'dd/MM/yyyy HH:mm') : '')
        );
      });
    }

    body.appendParagraph(
      'Báo cáo được tạo tự động từ dữ liệu hệ thống. Cần kiểm tra trước khi sử dụng chính thức.'
    ).setItalic(true);

    doc.saveAndClose();

    const reportsFolder = DriveApp.getFolderById(DriveService.getFolderIdByKey('REPORTS'));
    const source = DriveApp.getFileById(doc.getId());
    const pdfBlob = source.getAs(MimeType.PDF).setName(title + '.pdf');
    const pdfFile = reportsFolder.createFile(pdfBlob);
    source.setTrashed(true);

    ActivityService.log('EXPORT_PDF','REPORT',pdfFile.getId(),{
      name:pdfFile.getName(),
      from:fromText,
      to:toText
    });

    return {
      ok:true,
      fileId:pdfFile.getId(),
      name:pdfFile.getName(),
      url:pdfFile.getUrl()
    };
  }

  // =========================
  // ADMIN / PRODUCTION
  // =========================
  function diagnostics() {
    const me = me_();
    if (me.role !== 'ADMIN') throw new Error('Chỉ ADMIN được xem chẩn đoán hệ thống.');

    const info = SystemConfig.getSystemInfo();
    const db = SystemConfig.getDb();
    const root = DriveApp.getFolderById(SystemConfig.getRootFolderId());
    const triggers = ScriptApp.getProjectTriggers();

    const sheetCounts = {};
    ['USERS','DOCUMENTS','TASKS','MEETINGS','CALENDAR','NOTIFICATIONS','ACTIVITY_LOG']
      .forEach(name => {
        const sh = db.getSheetByName(name);
        sheetCounts[name] = sh ? Math.max(0,sh.getLastRow()-1) : -1;
      });

    return {
      ok:true,
      version:VERSION,
      database:{ok:Boolean(info.databaseId),id:info.databaseId,name:db.getName()},
      drive:{ok:Boolean(info.rootFolderId),id:info.rootFolderId,name:root.getName(),url:root.getUrl()},
      triggers:triggers.map(t => ({
        handler:t.getHandlerFunction(),
        eventType:String(t.getEventType())
      })),
      reminderInstalled:triggers.some(t => t.getHandlerFunction() === 'runB6ReminderScan'),
      sheetCounts,
      checkedAt:new Date().toISOString()
    };
  }

  function installReminderTrigger() {
    const me = me_();
    if (me.role !== 'ADMIN') throw new Error('Chỉ ADMIN được cài trigger.');
    return installB6Triggers();
  }

  function createBackup() {
    const me = me_();
    if (me.role !== 'ADMIN') throw new Error('Chỉ ADMIN được tạo sao lưu.');

    const root = DriveApp.getFolderById(rootId_());
    const it = root.getFoldersByName('99_Backup');
    const folder = it.hasNext() ? it.next() : root.createFolder('99_Backup');

    const dbFile = DriveApp.getFileById(SystemConfig.getDbId());
    const name = 'VPDU_BACKUP_' + Utilities.formatDate(new Date(),TZ,'yyyyMMdd_HHmmss');
    const copy = dbFile.makeCopy(name,folder);

    ActivityService.log('BACKUP','SYSTEM',copy.getId(),{name});
    return {ok:true,id:copy.getId(),name:copy.getName(),url:copy.getUrl()};
  }

  // =========================
  // GLOBAL SEARCH
  // =========================
  function globalSearch(query) {
    const me = me_();
    const q = clean_(query).toLowerCase();
    if (q.length < 2) return {ok:true,items:[]};

    const users = userMap_();
    const items = [];

    if (hasPerm_(me,'documents.view')) {
      RepositoryService.getAll('DOCUMENTS')
        .filter(d => [d.document_no,d.title,d.issuer,d.summary]
          .some(v => String(v || '').toLowerCase().includes(q)))
        .slice(0,8)
        .forEach(d => items.push({
          type:'DOCUMENT',
          id:d.document_id,
          title:[d.document_no,d.title].filter(Boolean).join(' · '),
          subtitle:d.issuer || 'Văn bản',
          date:d.received_date || d.created_at || ''
        }));
    }

    if (hasPerm_(me,'tasks.view')) {
      RepositoryService.getAll('TASKS')
        .filter(t => [t.title,t.description,users[t.owner_user_id]?.full_name]
          .some(v => String(v || '').toLowerCase().includes(q)))
        .slice(0,8)
        .forEach(t => items.push({
          type:'TASK',
          id:t.task_id,
          title:t.title,
          subtitle:users[t.owner_user_id]?.full_name || 'Nhiệm vụ',
          date:t.due_date || t.created_at || ''
        }));
    }

    if (hasPerm_(me,'meetings.view')) {
      RepositoryService.getAll('MEETINGS')
        .filter(m => [m.title,m.agenda,m.location,m.chairperson]
          .some(v => String(v || '').toLowerCase().includes(q)))
        .slice(0,8)
        .forEach(m => items.push({
          type:'MEETING',
          id:m.meeting_id,
          title:m.title,
          subtitle:m.location || 'Cuộc họp',
          date:m.meeting_date || ''
        }));
    }

    items.sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
    return {ok:true,items:items.slice(0,20)};
  }

  return {
    calendarList,
    createCalendar,
    updateCalendar,
    cancelCalendar,
    meetingList,
    meetingGet,
    createMeeting,
    updateMeeting,
    saveMeetingNotes,
    addMeetingFile,
    repositoryList,
    repositoryCreateFolder,
    repositoryUpload,
    repositoryRename,
    repositoryTrash,
    repositoryFavorite,
    repositorySearch,
    repositoryRecent,
    repositoryFavorites,
    reportData,
    exportReportPdf,
    diagnostics,
    installReminderTrigger,
    createBackup,
    globalSearch
  };
})();