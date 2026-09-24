const RepositoryService = (() => {
  const AUTH_USERS_CACHE_KEY = 'VPDU_AUTH_USERS_V1';
  const ROW_CACHE_PREFIX = 'VPDU_ROWS_V1_';
  const runtimeHeaders = {};
  const runtimeRows = {};
  const runtimeIdRows = {};

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
    const name = sheet.getName();
    if (runtimeHeaders[name]) return runtimeHeaders[name];
    const lastCol = sheet.getLastColumn();
    if (!lastCol) return [];
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    runtimeHeaders[name] = headers;
    return headers;
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

  function invalidateSheetCaches_(sheetName, keepRuntimeRows) {
    try {
      const cache = CacheService.getScriptCache();
      cache.remove(rowCacheKey_(sheetName));
      if (sheetName === 'USERS') cache.remove(AUTH_USERS_CACHE_KEY);
    } catch (e) {}

    if (!keepRuntimeRows) delete runtimeRows[sheetName];
    delete runtimeIdRows[sheetName];
  }

  function findRowNumber_(sheet, headers, idColumn, id) {
    const sheetName = sheet.getName();
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error('Không tìm thấy cột ID: ' + idColumn);

    runtimeIdRows[sheetName] = runtimeIdRows[sheetName] || {};
    const cacheKey = idColumn;
    if (!runtimeIdRows[sheetName][cacheKey]) {
      const map = {};

      // Nếu getAll() đã chạy trong request này, thứ tự mảng chính là thứ tự hàng.
      // Không cần quét lại cột ID.
      if (runtimeRows[sheetName]) {
        runtimeRows[sheetName].forEach((obj, i) => {
          const key = String(obj[idColumn] == null ? '' : obj[idColumn]);
          if (key) map[key] = i + 2;
        });
      } else {
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          const ids = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getDisplayValues();
          ids.forEach((row, i) => {
            const key = String(row[0]);
            if (key) map[key] = i + 2;
          });
        }
      }
      runtimeIdRows[sheetName][cacheKey] = map;
    }

    return runtimeIdRows[sheetName][cacheKey][String(id)] || -1;
  }

  function getAll(sheetName) {
    if (runtimeRows[sheetName]) return runtimeRows[sheetName].slice();

    const ttl = ROW_CACHE_TTL[sheetName] || 0;
    if (ttl) {
      try {
        const cached = CacheService.getScriptCache().get(rowCacheKey_(sheetName));
        if (cached) {
          runtimeRows[sheetName] = JSON.parse(cached);
          return runtimeRows[sheetName].slice();
        }
      } catch (e) {}
    }

    const sh = SystemConfig.getSheet(sheetName);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= 1 || lastCol <= 0) return [];

    const headers = getHeaders_(sh);
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const rows = values.map(r => rowToObject_(headers, r));
    runtimeRows[sheetName] = rows;

    if (ttl) {
      try {
        const json = JSON.stringify(rows);
        // CacheService giới hạn kích thước mỗi key; bỏ cache nếu dataset đã lớn.
        if (json.length < 90000) {
          CacheService.getScriptCache().put(rowCacheKey_(sheetName), json, ttl);
        }
      } catch (e) {}
    }
    return rows.slice();
  }

  function findById(sheetName, idColumn, id) {
    if (runtimeRows[sheetName]) {
      const hit = runtimeRows[sheetName].find(
        x => String(x[idColumn]) === String(id)
      );
      if (hit) return hit;
    }

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

    // setValues nhanh và ổn định hơn appendRow khi ghi thường xuyên.
    const rowNumber = Math.max(2, sh.getLastRow() + 1);
    sh.getRange(rowNumber, 1, 1, row.length).setValues([row]);

    if (runtimeRows[sheetName]) {
      runtimeRows[sheetName].push(rowToObject_(headers, row));
    }
    invalidateSheetCaches_(sheetName, true);
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

    const updated = rowToObject_(headers, row);
    if (runtimeRows[sheetName]) {
      const idx = runtimeRows[sheetName].findIndex(x => String(x[idColumn]) === String(id));
      if (idx >= 0) runtimeRows[sheetName][idx] = updated;
    }
    invalidateSheetCaches_(sheetName, true);
    return updated;
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
      runtimeRows[sheetName] = data.map(row => rowToObject_(headers,row));
      invalidateSheetCaches_(sheetName, true);
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