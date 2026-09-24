const RepositoryService = (() => {
  const AUTH_USERS_CACHE_KEY = 'VPDU_AUTH_USERS_V1';
  const ROW_CACHE_PREFIX = 'VPDU_ROWS_V1_';
  const ROW_CACHE_TTL = {
    DOCUMENTS:20,
    TASKS:20,
    CALENDAR:20,
    MEETINGS:20,
    MEETING_MEMBERS:20,
    MEETING_TASKS:20,
    MEETING_FILES:20,
    TASK_FILES:20,
    TASK_HISTORY:10,
    DOCUMENT_FILES:20,
    DOCUMENT_HISTORY:10,
    NOTIFICATIONS:10,
    DEPARTMENTS:60,
    SETTINGS:300,
    CATEGORIES:120
  };

  function rowCacheKey_(sheetName) {
    return ROW_CACHE_PREFIX + sheetName;
  }

  function getHeaders_(sheet) {
    const lastCol = sheet.getLastColumn();
    if (!lastCol) return [];
    return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  function rowToObject_(headers, row) {
    const obj = {};
    headers.forEach((h, i) => obj[h] = serializeValue_(row[i]));
    return obj;
  }

  function serializeValue_(v) {
    if (v instanceof Date) return v.toISOString();
    return v;
  }

  function invalidateSheetCaches_(sheetName) {
    try {
      const cache = CacheService.getScriptCache();
      cache.remove(rowCacheKey_(sheetName));
      if (sheetName === 'USERS') cache.remove(AUTH_USERS_CACHE_KEY);
    } catch (e) {}
  }

  function findRowNumber_(sheet, headers, idColumn, id) {
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error('Không tìm thấy cột ID: ' + idColumn);

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return -1;

    // Chỉ đọc đúng cột ID thay vì đọc toàn bộ sheet.
    const ids = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getDisplayValues();
    const target = String(id);
    const pos = ids.findIndex(row => String(row[0]) === target);
    return pos < 0 ? -1 : pos + 2;
  }

  function getAll(sheetName) {
    const ttl = ROW_CACHE_TTL[sheetName] || 0;
    if (ttl) {
      try {
        const cached = CacheService.getScriptCache().get(rowCacheKey_(sheetName));
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }

    const sh = SystemConfig.getSheet(sheetName);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= 1 || lastCol <= 0) return [];

    const headers = getHeaders_(sh);
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const rows = values.map(r => rowToObject_(headers, r));

    if (ttl) {
      try {
        const json = JSON.stringify(rows);
        // CacheService giới hạn kích thước mỗi key; bỏ cache nếu dataset đã lớn.
        if (json.length < 90000) {
          CacheService.getScriptCache().put(rowCacheKey_(sheetName), json, ttl);
        }
      } catch (e) {}
    }
    return rows;
  }

  function findById(sheetName, idColumn, id) {
    const sh = SystemConfig.getSheet(sheetName);
    const headers = getHeaders_(sh);
    const rowNumber = findRowNumber_(sh, headers, idColumn, id);
    if (rowNumber < 0) return null;

    const row = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    return rowToObject_(headers, row);
  }

  function append(sheetName, data) {
    const sh = SystemConfig.getSheet(sheetName);
    const headers = getHeaders_(sh);
    const row = headers.map(h => data[h] !== undefined ? data[h] : '');
    sh.appendRow(row);
    invalidateSheetCaches_(sheetName);
    return data;
  }

  function updateById(sheetName, idColumn, id, patch) {
    const sh = SystemConfig.getSheet(sheetName);
    const headers = getHeaders_(sh);
    const rowNumber = findRowNumber_(sh, headers, idColumn, id);
    if (rowNumber < 0) return null;

    // Đọc 1 hàng, sửa trong bộ nhớ, rồi ghi lại đúng 1 lần.
    // Trước P1: mỗi field patch gọi setValue() riêng và cuối cùng đọc lại toàn sheet.
    const row = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];

    Object.keys(patch || {}).forEach(key => {
      const col = headers.indexOf(key);
      if (col >= 0) row[col] = patch[key];
    });

    sh.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
    invalidateSheetCaches_(sheetName);
    return rowToObject_(headers, row);
  }


  function batchUpdateByIds(sheetName, idColumn, updates) {
    updates = Array.isArray(updates) ? updates.filter(Boolean) : [];
    if (!updates.length) return {updated:0};

    const sh = SystemConfig.getSheet(sheetName);
    const headers = getHeaders_(sh);
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error('Không tìm thấy cột ID: ' + idColumn);

    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return {updated:0};

    const data = sh.getRange(2,1,lastRow-1,headers.length).getValues();
    const patchMap = {};
    updates.forEach(x => {
      if (x && x.id !== undefined) patchMap[String(x.id)] = x.patch || {};
    });

    let changed = 0;
    data.forEach(row => {
      const patch = patchMap[String(row[idIndex])];
      if (!patch) return;
      Object.keys(patch).forEach(key => {
        const col = headers.indexOf(key);
        if (col >= 0) row[col] = patch[key];
      });
      changed++;
    });

    if (changed) {
      sh.getRange(2,1,data.length,headers.length).setValues(data);
      invalidateSheetCaches_(sheetName);
    }
    return {updated:changed};
  }

  function deleteWhere(sheetName, predicate) {
    const sh = SystemConfig.getSheet(sheetName);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= 1 || lastCol <= 0) return {deleted:0};

    const headers = getHeaders_(sh);
    const rows = sh.getRange(2,1,lastRow-1,lastCol).getValues();
    const deleteRows = [];

    rows.forEach((row,i) => {
      const obj = rowToObject_(headers,row);
      if (predicate(obj)) deleteRows.push(i+2);
    });

    for (let i=deleteRows.length-1;i>=0;i--) {
      sh.deleteRow(deleteRows[i]);
    }
    if (deleteRows.length) invalidateSheetCaches_(sheetName);
    return {deleted:deleteRows.length};
  }

  return {
    getAll,
    findById,
    append,
    updateById,
    batchUpdateByIds,
    deleteWhere
  };
})();