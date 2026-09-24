function apiC1GetAiConfig() {
  return C1AiService.getConfig();
}

function apiC1SaveAiConfig(provider, apiKey, model) {
  return C1AiService.saveConfig(provider, apiKey, model);
}

function apiC1ListAiFiles(folderId) {
  return C1AiService.listFiles(folderId || '');
}

function apiC1RunAdvisory(request) {
  return C1AiService.run(request || {});
}