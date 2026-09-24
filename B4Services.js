const B4RepositoryService = (() => {
  function rootFolderId_() {
    const id = SystemConfig.getRootFolderId();
    if (!id) throw new Error('Chưa có thư mục gốc của hệ thống.');
    return id;
  }

  function isInsideRoot_(folderId) {
    const rootId = rootFolderId_();
    if (folderId === rootId) return true;

    let current = DriveApp.getFolderById(folderId);
    for (let depth = 0; depth < 12; depth++) {
      const parents = current.getParents();
      if (!parents.hasNext()) return false;
      const parent = parents.next();
      if (parent.getId() === rootId) return true;
      current = parent;
    }
    return false;
  }

  function safeFolder_(folderId) {
    const id = folderId || rootFolderId_();
    if (!isInsideRoot_(id)) {
      throw new Error('Thư mục không thuộc kho hồ sơ số.');
    }
    return DriveApp.getFolderById(id);
  }

  function folderToItem_(folder) {
    return {
      id: folder.getId(),
      name: folder.getName(),
      type: 'folder',
      url: folder.getUrl()
    };
  }

  function fileToItem_(file) {
    return {
      id: file.getId(),
      name: file.getName(),
      type: 'file',
      mimeType: file.getMimeType(),
      size: file.getSize(),
      updatedAt: file.getLastUpdated().toISOString(),
      url: file.getUrl()
    };
  }

  function listFolder(folderId) {
    AuthService.requirePermission('repository.view');

    const folder = safeFolder_(folderId);
    const folders = [];
    const files = [];

    const fit = folder.getFolders();
    while (fit.hasNext()) folders.push(folderToItem_(fit.next()));

    const it = folder.getFiles();
    while (it.hasNext()) files.push(fileToItem_(it.next()));

    folders.sort((a,b) => a.name.localeCompare(b.name, 'vi'));
    files.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    let parentId = '';
    if (folder.getId() !== rootFolderId_()) {
      const parents = folder.getParents();
      if (parents.hasNext()) {
        const p = parents.next();
        if (isInsideRoot_(p.getId())) parentId = p.getId();
      }
    }

    return {
      folder: folderToItem_(folder),
      rootFolderId: rootFolderId_(),
      parentId,
      folders,
      files
    };
  }

  function createFolder(parentId, name) {
    AuthService.requirePermission('repository.upload');

    const clean = String(name || '').trim();
    if (!clean) throw new Error('Tên thư mục không được để trống.');
    if (clean.length > 100) throw new Error('Tên thư mục quá dài.');

    const parent = safeFolder_(parentId);
    const folder = parent.createFolder(clean);

    ActivityService.log('CREATE_FOLDER','REPOSITORY',folder.getId(),{
      name:clean,
      parentId:parent.getId()
    });

    return folderToItem_(folder);
  }

  function upload(parentId, file) {
    AuthService.requirePermission('repository.upload');
    if (!file || !file.base64) throw new Error('Bạn chưa chọn tệp.');

    const parent = safeFolder_(parentId);
    const saved = DriveService.saveBase64FileToFolder(file, parent.getId());

    ActivityService.log('UPLOAD_FILE','REPOSITORY',saved.fileId,{
      name:saved.name,
      folderId:parent.getId()
    });

    return saved;
  }

  function search(query) {
    AuthService.requirePermission('repository.view');

    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const root = DriveApp.getFolderById(rootFolderId_());
    const results = [];
    scanFolder_(root, q, results, 0);

    return results.slice(0, 100);
  }

  function scanFolder_(folder, query, results, depth) {
    if (depth > 6 || results.length >= 100) return;

    const fit = folder.getFolders();
    while (fit.hasNext() && results.length < 100) {
      const child = fit.next();
      if (child.getName().toLowerCase().includes(query)) {
        results.push(folderToItem_(child));
      }
      scanFolder_(child, query, results, depth + 1);
    }

    const files = folder.getFiles();
    while (files.hasNext() && results.length < 100) {
      const file = files.next();
      if (file.getName().toLowerCase().includes(query)) {
        results.push(fileToItem_(file));
      }
    }
  }

  return {listFolder, createFolder, upload, search};
})();


const B4ReportService = (() => {
  function monthKey_(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return '';
    return Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM');
  }

  function getReportData() {
    AuthService.requirePermission('reports.view');

    const tasks = TaskService.list();
    const documents = DocumentService.list();
    const now = new Date();

    const completed = tasks.filter(t => t.status === 'COMPLETED').length;
    const overdue = tasks.filter(t => t.effective_status === 'OVERDUE').length;
    const inProgress = tasks.filter(t => t.effective_status === 'IN_PROGRESS').length;
    const waiting = tasks.filter(t => t.effective_status === 'WAITING_APPROVAL').length;
    const pending = tasks.filter(t => ['NEW','IN_PROGRESS','WAITING_APPROVAL','OVERDUE'].includes(t.effective_status));

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM');
      const label = 'T' + (d.getMonth() + 1);
      const monthTasks = tasks.filter(t => monthKey_(t.created_at || t.start_date || t.due_date) === key);

      months.push({
        key,
        label,
        completed: monthTasks.filter(t => t.status === 'COMPLETED').length,
        processing: monthTasks.filter(t => ['NEW','IN_PROGRESS','WAITING_APPROVAL'].includes(t.effective_status)).length,
        overdue: monthTasks.filter(t => t.effective_status === 'OVERDUE').length
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        totalTasks: tasks.length,
        completed,
        inProgress,
        waitingApproval: waiting,
        overdue,
        totalDocuments: documents.length,
        incomingDocuments: documents.filter(d => d.direction === 'INCOMING').length,
        outgoingDocuments: documents.filter(d => d.direction === 'OUTGOING').length
      },
      months,
      attention: pending
        .sort((a,b) => {
          const aa = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
          const bb = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
          return aa - bb;
        })
        .slice(0, 5)
    };
  }

  return {getReportData};
})();