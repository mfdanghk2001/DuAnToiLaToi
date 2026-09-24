const DriveService = (() => {
  function getFolderIdByKey(key) {
    const settings = RepositoryService.getAll('SETTINGS');
    const map = {
      INCOMING: 'FOLDER_INCOMING',
      OUTGOING: 'FOLDER_OUTGOING',
      DRAFT: 'FOLDER_DRAFTS',
      DRAFTS: 'FOLDER_DRAFTS',
      MEETINGS: 'FOLDER_MEETINGS',
      REPORTS: 'FOLDER_REPORTS',
      TEMPLATES: 'FOLDER_TEMPLATES',
      REFERENCES: 'FOLDER_REFERENCES',
      ATTACHMENTS: 'FOLDER_ATTACHMENTS'
    };
    const settingKey = map[key] || 'FOLDER_ATTACHMENTS';
    const row = settings.find(x => x.setting_key === settingKey);
    if (!row || !row.setting_value) {
      throw new Error('Không tìm thấy cấu hình thư mục: ' + settingKey);
    }
    return row.setting_value;
  }

  function saveBase64File(file, folderKey) {
    if (!file || !file.base64 || !file.name) return null;
    const folder = DriveApp.getFolderById(getFolderIdByKey(folderKey || 'ATTACHMENTS'));
    return saveBase64FileToFolder(file, folder.getId());
  }

  function saveBase64FileToFolder(file, folderId) {
    if (!file || !file.base64 || !file.name) return null;

    const folder = DriveApp.getFolderById(folderId);
    const raw = String(file.base64).replace(/^data:[^;]+;base64,/, '');
    const bytes = Utilities.base64Decode(raw);
    const blob = Utilities.newBlob(
      bytes,
      file.mimeType || 'application/octet-stream',
      file.name
    );
    const created = folder.createFile(blob);

    return {
      fileId: created.getId(),
      name: created.getName(),
      url: created.getUrl(),
      mimeType: created.getMimeType(),
      size: created.getSize(),
      folderId: folder.getId()
    };
  }

  function createMeetingFolder(meetingId, title, meetingDate) {
    const root = DriveApp.getFolderById(getFolderIdByKey('MEETINGS'));
    const safeTitle = String(title || 'Cuoc-hop')
      .replace(/[\\/:*?"<>|#%]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    const dateText = meetingDate
      ? Utilities.formatDate(new Date(meetingDate), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
      : Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');

    const folder = root.createFolder(`${dateText}_${safeTitle}_${String(meetingId).slice(0, 8)}`);
    return {
      folderId: folder.getId(),
      url: folder.getUrl(),
      name: folder.getName()
    };
  }

  return {
    getFolderIdByKey,
    saveBase64File,
    saveBase64FileToFolder,
    createMeetingFolder
  };
})();