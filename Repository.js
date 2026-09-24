const RepositoryService = (() => {
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

  function getAll(sheetName) {
    const sh = SystemConfig.getSheet(sheetName);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= 1) return [];

    const headers = getHeaders_(sh);
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    return values.map(r => rowToObject_(headers, r));
  }

  function findById(sheetName, idColumn, id) {
    return getAll(sheetName).find(x => String(x[idColumn]) === String(id)) || null;
  }

  function append(sheetName, data) {
    const sh = SystemConfig.getSheet(sheetName);
    const headers = getHeaders_(sh);
    const row = headers.map(h => data[h] !== undefined ? data[h] : '');
    sh.appendRow(row);
    return data;
  }

  function updateById(sheetName, idColumn, id, patch) {
    const sh = SystemConfig.getSheet(sheetName);
    const headers = getHeaders_(sh);
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error('Không tìm thấy cột ID: ' + idColumn);

    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return null;

    const ids = sh.getRange(2, idIndex + 1, lastRow - 1, 1).getValues().flat();
    const pos = ids.findIndex(v => String(v) === String(id));
    if (pos < 0) return null;

    const rowNumber = pos + 2;
    Object.keys(patch).forEach(key => {
      const col = headers.indexOf(key);
      if (col >= 0) sh.getRange(rowNumber, col + 1).setValue(patch[key]);
    });

    return findById(sheetName, idColumn, id);
  }

  return {getAll, findById, append, updateById};
})();