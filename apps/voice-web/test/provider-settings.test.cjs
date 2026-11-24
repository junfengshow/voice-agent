// 主逻辑
// 模拟浏览器存储和页面重新加载，验证服务配置的保存、恢复与清除。

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, '../src/services/provider-settings.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});

function loadSettings(localStorage) {
  const exports = {};
  runInNewContext(outputText, { exports, window: { localStorage } });
  return exports;
}

test('服务配置可在页面重新加载后恢复，并可从本机清除', () => {
  const data = new Map();
  const localStorage = {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const settings = {
    asrModel: 'custom-asr',
    llmModel: 'custom-llm',
    ttsModel: 'custom-tts',
    ttsVoice: 'Cherry',
    searchEngine: 'search_pro',
    dashscopeRegion: 'intl',
    dashscopeApiKey: 'test-dashscope',
    deepseekApiKey: 'test-deepseek',
    zhipuApiKey: 'test-zhipu',
  };

  const page = loadSettings(localStorage);
  assert.equal(page.readProviderSettings(), undefined);
  page.saveProviderSettings(settings);
  const reloadedPage = loadSettings(localStorage);
  assert.deepEqual(JSON.parse(JSON.stringify(reloadedPage.readProviderSettings())), settings);
  reloadedPage.clearProviderSettings();
  assert.equal(page.readProviderSettings(), undefined);
  assert.equal(data.size, 0);
});
