const RepositoryService = (() => {
  const AUTH_USERS_CACHE_KEY = 'VPDU_AUTH_USERS_V1';

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
    if (sheetName === 'USERS') {
      try {
        CacheService.getScriptCache().remove(AUTH_USERS_CACHE_KEY);
      } catch (e) {}
    }
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
    const sh = SystemConfig.getSheet(sheetName);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= 1 || lastCol <= 0) return [];

    const headers = getHeaders_(sh);
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    return values.map(r => rowToObject_(headers, r));
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

  return {getAll, findById, append, updateById};
})();