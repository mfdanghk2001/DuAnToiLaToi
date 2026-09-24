const C1AiService = (() => {
  const PROP_PROVIDER = 'VPDU_AI_PROVIDER';
  const PROP_API_KEY = 'VPDU_AI_API_KEY';
  const PROP_MODEL = 'VPDU_AI_MODEL';

  function props_() {
    return PropertiesService.getScriptProperties();
  }

  function getConfig() {
    const p = props_();
    return {
      provider: p.getProperty(PROP_PROVIDER) || '',
      model: p.getProperty(PROP_MODEL) || '',
      hasApiKey: Boolean(p.getProperty(PROP_API_KEY))
    };
  }

  function saveConfig(provider, apiKey, model) {
    const me = AuthService.getCurrentUser();
    if (!me.authenticated || me.role !== 'ADMIN') {
      throw new Error('Chỉ ADMIN được cấu hình AI.');
    }

    provider = String(provider || '').trim().toUpperCase();
    model = String(model || '').trim();

    if (!['GEMINI'].includes(provider)) {
      throw new Error('C1 hiện hỗ trợ provider GEMINI.');
    }
    if (!model) throw new Error('Bạn chưa nhập tên model.');

    const p = props_();
    const data = {
      [PROP_PROVIDER]: provider,
      [PROP_MODEL]: model
    };

    if (String(apiKey || '').trim()) {
      data[PROP_API_KEY] = String(apiKey).trim();
    }

    p.setProperties(data, false);
    return getConfig();
  }

  function getApiKey_() {
    const key = props_().getProperty(PROP_API_KEY);
    if (!key) {
      throw new Error('Chưa cấu hình API key cho Trợ lý tham mưu.');
    }
    return key;
  }

  function ensurePermission_() {
    AuthService.requirePermission('advisory.use');
  }

  function safeFolderId_(folderId) {
    const rootId = SystemConfig.getRootFolderId();
    if (!folderId) return rootId;

    const target = DriveApp.getFolderById(folderId);
    if (target.getId() === rootId) return rootId;

    let current = target;
    for (let i = 0; i < 12; i++) {
      const parents = current.getParents();
      if (!parents.hasNext()) break;
      const parent = parents.next();
      if (parent.getId() === rootId) return target.getId();
      current = parent;
    }

    throw new Error('Thư mục không thuộc kho hồ sơ số.');
  }

  function listFiles(folderId) {
    ensurePermission_();

    const folder = DriveApp.getFolderById(safeFolderId_(folderId));
    const folders = [];
    const files = [];

    const fit = folder.getFolders();
    while (fit.hasNext()) {
      const f = fit.next();
      folders.push({
        id: f.getId(),
        name: f.getName(),
        type: 'folder'
      });
    }

    const it = folder.getFiles();
    while (it.hasNext()) {
      const file = it.next();
      files.push({
        id: file.getId(),
        name: file.getName(),
        type: 'file',
        mimeType: file.getMimeType(),
        size: file.getSize()
      });
    }

    folders.sort((a,b) => a.name.localeCompare(b.name, 'vi'));
    files.sort((a,b) => a.name.localeCompare(b.name, 'vi'));

    return {
      folder: {id: folder.getId(), name: folder.getName()},
      rootFolderId: SystemConfig.getRootFolderId(),
      folders,
      files
    };
  }

  function getFilePart_(fileId) {
    const file = DriveApp.getFileById(fileId);
    const mime = file.getMimeType();
    const name = file.getName();

    if (mime === MimeType.GOOGLE_DOCS) {
      const text = DocumentApp.openById(fileId).getBody().getText();
      return {
        name,
        displayType: 'Google Docs',
        parts: [{text: `\n--- TÀI LIỆU: ${name} ---\n${text}\n--- HẾT TÀI LIỆU ---\n`}]
      };
    }

    if (mime === MimeType.PLAIN_TEXT || mime === 'text/csv' || mime === 'text/html') {
      const text = file.getBlob().getDataAsString('UTF-8');
      return {
        name,
        displayType: mime,
        parts: [{text: `\n--- TÀI LIỆU: ${name} ---\n${text}\n--- HẾT TÀI LIỆU ---\n`}]
      };
    }

    if (mime === MimeType.PDF || mime.startsWith('image/')) {
      const blob = file.getBlob();
      return {
        name,
        displayType: mime,
        parts: [{
          inline_data: {
            mime_type: mime,
            data: Utilities.base64Encode(blob.getBytes())
          }
        }]
      };
    }

    throw new Error(
      `C1 chưa đọc trực tiếp định dạng "${name}" (${mime}). ` +
      'Hãy dùng Google Docs, TXT, PDF hoặc ảnh.'
    );
  }

  function buildSystemInstruction_(taskType) {
    const base =
`Bạn là trợ lý nghiệp vụ cho Văn phòng Đảng ủy.
Mục tiêu của bạn là hỗ trợ cán bộ tham mưu, tổng hợp, soạn thảo và rà soát.
Luôn viết bằng tiếng Việt hành chính, rõ ràng, mạch lạc, có cấu trúc.
Không tự bịa số liệu, căn cứ, tên cơ quan, số văn bản hoặc kết luận chưa có trong dữ liệu.
Nếu thiếu dữ liệu quan trọng, phải ghi rõ "[CẦN BỔ SUNG: ...]".
Mọi đầu ra là BẢN NHÁP HỖ TRỢ, cán bộ phải kiểm tra trước khi trình hoặc ban hành.`;

    const extra = {
      DRAFT:
`Nhiệm vụ: soạn dự thảo văn bản.
Ưu tiên bố cục hành chính, câu chữ ngắn gọn, nêu rõ phần cần người dùng bổ sung.`,
      SUMMARY:
`Nhiệm vụ: tóm tắt tài liệu.
Đầu ra gồm: (1) Tóm tắt điều hành; (2) Ý chính; (3) Việc cần triển khai; (4) Mốc thời gian nếu có.`,
      REVIEW:
`Nhiệm vụ: rà soát dự thảo.
Chỉ ra: lỗi câu chữ, điểm chưa logic, thông tin thiếu, chỗ cần kiểm chứng, và đề xuất bản sửa.`,
      CONCLUSION:
`Nhiệm vụ: từ biên bản/tài liệu họp, dự thảo thông báo kết luận.
Phân tách rõ: nội dung kết luận, đơn vị/người thực hiện, thời hạn nếu có, và phần cần xác nhận.`,
      REPORT:
`Nhiệm vụ: tổng hợp báo cáo.
Phân nhóm nội dung, nêu kết quả, tồn tại, nhiệm vụ tiếp theo; không bịa số liệu.`,
      GENERAL:
`Nhiệm vụ: hỗ trợ tham mưu theo yêu cầu người dùng.`
    };

    return base + '\n\n' + (extra[taskType] || extra.GENERAL);
  }

  function callGemini_(request) {
    const cfg = getConfig();
    if (cfg.provider !== 'GEMINI' || !cfg.model) {
      throw new Error('AI chưa được cấu hình. ADMIN cần nhập provider/model/API key.');
    }

    const key = getApiKey_();

    // C1.2: ưu tiên model cấu hình, sau đó fallback nếu chỉ gặp lỗi quá tải/rate-limit.
    const fallbackModels = [
      cfg.model,
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite'
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    let lastError = null;

    for (let modelIndex = 0; modelIndex < fallbackModels.length; modelIndex++) {
      const model = fallbackModels[modelIndex];

      // Lần đầu + 2 retry với backoff ngắn.
      const retryDelays = [0, 1500, 3500];

      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
        if (retryDelays[attempt] > 0) {
          Utilities.sleep(retryDelays[attempt]);
        }

        const url =
          'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(model) +
          ':generateContent?key=' +
          encodeURIComponent(key);

        const payload = {
          system_instruction: {
            parts: [{text: buildSystemInstruction_(request.taskType || 'GENERAL')}]
          },
          contents: [{
            role: 'user',
            parts: request.parts
          }],
          generationConfig: {
            maxOutputTokens: 6000
          }
        };

        let res;
        try {
          res = UrlFetchApp.fetch(url, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
          });
        } catch (networkError) {
          lastError = networkError;
          continue;
        }

        const statusCode = res.getResponseCode();
        const responseText = res.getContentText();

        let json = {};
        try {
          json = JSON.parse(responseText);
        } catch (e) {}

        if (statusCode >= 200 && statusCode < 300) {
          const candidates = json.candidates || [];
          const outputParts = candidates[0]?.content?.parts || [];
          const output = outputParts
            .map(p => p.text || '')
            .filter(Boolean)
            .join('\n')
            .trim();

          if (!output) {
            throw new Error('AI không trả về nội dung.');
          }

          return {
            output,
            modelUsed: model,
            fallbackUsed: model !== cfg.model
          };
        }

        const message =
          json?.error?.message ||
          `AI request thất bại (HTTP ${statusCode}).`;

        lastError = new Error(message);

        const transient =
          statusCode === 429 ||
          statusCode === 500 ||
          statusCode === 502 ||
          statusCode === 503 ||
          statusCode === 504;

        // Lỗi key/quyền/request sai thì dừng luôn, không retry model khác.
        if (!transient) {
          throw lastError;
        }
      }
    }

    throw new Error(
      (lastError?.message || 'Dịch vụ AI đang tạm thời quá tải.') +
      ' Hệ thống đã tự thử lại và thử model dự phòng nhưng chưa thành công.'
    );
  }

  function run(request) {
    ensurePermission_();

    request = request || {};
    const prompt = String(request.prompt || '').trim();
    const taskType = String(request.taskType || 'GENERAL').trim().toUpperCase();
    const fileIds = Array.isArray(request.fileIds) ? request.fileIds.slice(0, 4) : [];

    if (!prompt) throw new Error('Bạn chưa nhập yêu cầu.');

    const parts = [{text: prompt}];
    const fileNames = [];

    fileIds.forEach(id => {
      const data = getFilePart_(id);
      fileNames.push(data.name);
      data.parts.forEach(p => parts.push(p));
    });

    const aiResult = callGemini_({
      taskType,
      parts
    });

    ActivityService.log('AI_ASSIST','ADVISORY','',{
      taskType,
      files: fileNames,
      promptPreview: prompt.slice(0, 160),
      modelUsed: aiResult.modelUsed,
      fallbackUsed: aiResult.fallbackUsed
    });

    return {
      ok: true,
      output: aiResult.output,
      taskType,
      files: fileNames,
      modelUsed: aiResult.modelUsed,
      fallbackUsed: aiResult.fallbackUsed,
      generatedAt: new Date().toISOString(),
      disclaimer:
        'Bản nháp hỗ trợ — cần cán bộ kiểm tra trước khi trình hoặc ban hành.'
    };
  }

  return {
    getConfig,
    saveConfig,
    listFiles,
    run
  };
})();