import { api } from './api.js';
import { state, setState, refreshAll } from './store.js';
import { icon, esc } from './render.js';
import { toast } from './toast.js';
import {
  loadSnapshot,
  prefetchOffline,
  supportsOffline,
  isOfflineReady,
  getCachedIds,
  isAutoCacheEnabled,
  setAutoCacheEnabled,
  autoCache,
} from './offline.js';

let escapeHandler = null;

function closeDrawer() {
  document.getElementById('drawerRoot').innerHTML = '';
  document.body.classList.remove('modal-open');
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
}

function rulesMarkup(rules) {
  if (!rules) return '';
  const block = (title, items) =>
    items && items.length
      ? `<div class="rules-block"><strong>${title}</strong><div class="rules-wrap">${items
          .map((item) => `<span>${esc(item)}</span>`)
          .join('')}</div></div>`
      : '';

  return `${block('类型', rules.categories)}${block('主题关键词', rules.topics)}${block('常用标签', rules.tags)}`;
}

export async function openSettings() {
  let rules = state.rules;
  let settings = state.settings;
  let serverInfo = null;
  let offlineSnapshot = null;

  try {
    const [loadedRules, loadedSettings, loadedInfo, snapshot] = await Promise.all([
      rules || api.rules(),
      settings || api.settings(),
      api.serverInfo().catch(() => null),
      loadSnapshot(),
    ]);
    rules = loadedRules;
    settings = loadedSettings;
    serverInfo = loadedInfo;
    offlineSnapshot = snapshot;
    setState({ rules, settings });
  } catch (error) {
    toast(`读取设置失败：${error.message}`, { type: 'error' });
    return;
  }

  const ai = settings.ai || {};
  const hasApiKey = Boolean(settings.hasApiKey);
  const masked = ai.apiKey || '';
  let cleared = false;

  const cachedCount = offlineSnapshot?.files?.length || 0;
  const cachedTime = offlineSnapshot?.savedAt
    ? new Date(offlineSnapshot.savedAt).toLocaleString('zh-CN')
    : '';
  const autoCacheOn = isAutoCacheEnabled();
  const offlineStatusText = () =>
    !supportsOffline()
      ? '未启用：需要 HTTPS。用 Tailscale 提供 HTTPS 地址后即可离线。'
      : isOfflineReady()
        ? `已启用 · 索引 ${cachedCount} 个资源 · 已缓存 ${getCachedIds().size} 个文件${
            cachedTime ? ` · 同步于 ${cachedTime}` : ''
          }`
        : '正在准备离线缓存，刷新一次页面后生效';
  const offlineStatus = offlineStatusText();

  const lan = serverInfo?.addresses?.[0] || '';
  const phoneOrigin = lan ? `http://${lan}:${serverInfo.port}` : '';
  const onLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
  const collectEndpoint =
    onLocalhost && phoneOrigin ? `${phoneOrigin}/api/collect` : `${location.origin}/api/collect`;

  const drawerRoot = document.getElementById('drawerRoot');
  drawerRoot.innerHTML = `<div class="drawer-backdrop">
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="drawer-head">
        <h2 id="settingsTitle">设置</h2>
        <button class="icon-btn" type="button" data-settings-close aria-label="关闭">${icon('close')}</button>
      </div>
      <form id="settingsForm">
        <section class="settings-group">
          <h3>AI 增强（可选）</h3>
          <label class="switch-row"><input type="checkbox" name="enabled" ${
            ai.enabled ? 'checked' : ''
          }> 启用 AI 总结与建议</label>
          <label class="field">
            <span>接口地址（OpenAI 兼容）</span>
            <input name="baseURL" value="${esc(ai.baseURL || '')}" placeholder="https://api.openai.com/v1" spellcheck="false">
          </label>
          <label class="field">
            <span>模型</span>
            <input name="model" value="${esc(ai.model || '')}" placeholder="gpt-4o-mini" spellcheck="false">
            <small>日常建议 deepseek-chat；deepseek-reasoner 更慢、更耗 token。</small>
          </label>
          <label class="field">
            <span>API Key</span>
            <div class="key-row">
              <input name="apiKey" type="password" placeholder="${hasApiKey ? '已保存，留空不修改' : '粘贴你的 API Key'}" autocomplete="off" spellcheck="false">
              <button class="btn ghost" type="button" data-key-clear>清除</button>
            </div>
            <small id="keyHint">${hasApiKey ? `当前已保存：${esc(masked)}` : '密钥只保存在本机 data/settings.json 中。'}</small>
          </label>
          <label class="switch-row"><input type="checkbox" name="autoSummary" ${
            ai.autoSummaryOnUpload ? 'checked' : ''
          }> 上传后自动总结</label>
          <label class="switch-row"><input type="checkbox" name="autoClassify" ${
            ai.autoClassifyOnUpload ? 'checked' : ''
          }> 上传后自动分类（主题 + 标签 + 类型）</label>
          <p class="settings-note">开启后，文本、PDF、Word/PPT/Excel 的文字片段，以及图片本身，会发送到你配置的 AI 服务；图片总结需要模型支持视觉。自动分类会补全主题、标签和类型（有明确扩展名的按扩展名判断，其余交给 AI），不会改文件名；AI 不可用时不影响正常归类。</p>
          <div class="form-actions">
            <button class="btn ghost ai-glow" type="button" data-ai-test>测试连接</button>
            <button class="btn ghost" type="button" data-ai-classify>整理未分类文件</button>
            <span class="spacer"></span>
            <button class="btn primary" type="submit">保存设置</button>
          </div>
          <p class="settings-note" id="aiStatus"></p>
        </section>

        <section class="settings-group">
          <h3>界面配色 · 莫奈取色</h3>
          <p class="settings-note">参考 Android 的 Monet 动态取色：从一个颜色或一张图片生成整套配色，浅色与深色模式会自动适配，立即生效。</p>
          <div class="seed-row" id="seedRow">
            ${(window.RHMonet?.presets || [])
              .map(
                (preset) =>
                  `<button class="seed-chip" type="button" data-seed="${preset.seed}"><span class="seed-dot" style="background:${preset.seed}"></span>${preset.name}</button>`
              )
              .join('')}
            <button class="seed-chip" type="button" data-seed=""><span class="seed-dot" style="background:linear-gradient(135deg,#0e7c66,#c2733f)"></span>默认</button>
          </div>
          <div class="form-actions">
            <label class="btn ghost seed-upload">从图片取色
              <input type="file" accept="image/*" id="seedImage">
            </label>
            <span class="settings-note" id="seedStatus"></span>
          </div>
        </section>

        <section class="settings-group">
          <h3>离线与远程访问</h3>
          <p class="settings-note" id="offlineStatus">${offlineStatus}</p>
          <label class="switch-row"><input type="checkbox" name="autoCache" ${
            autoCacheOn ? 'checked' : ''
          }> 自动缓存文件（打开即后台缓存）</label>
          <p class="settings-note">开启后，每次打开资源站都会自动把收藏、最近浏览和最新文件缓存到手机，卡片上会显示「已缓存」；单个文件超过 30MB 不缓存，总量约 120MB。</p>
          <p class="settings-note">iPhone 离线缓存需要 HTTPS。推荐免费安装 Tailscale：电脑与手机登录同一账号，电脑执行 <code>tailscale serve --bg 5178</code>，手机打开生成的 https 地址并「添加到主屏幕」。</p>
          <div class="form-actions">
            <button class="btn ghost" type="button" data-offline-prefetch>立即缓存收藏与最近文件</button>
          </div>
          <p class="settings-note">电脑关机时仍可浏览已缓存的索引、封面和文件；收藏的链接、上传的照片会先存进「手机暂存」，电脑开机联网后自动同步。</p>
        </section>

        <section class="settings-group">
          <h3>手机一键收藏</h3>
          <p class="settings-note">用 iPhone「快捷指令」把分享链接 POST 到下面地址，即可收藏 B站、小红书、微信文章和 Instagram。手机需与电脑连同一个 Wi-Fi。</p>
          <label class="field">
            <span>收藏接口（手机用）</span>
            <div class="key-row">
              <input id="collectEndpoint" readonly value="${collectEndpoint}">
              <button class="btn ghost" type="button" data-copy-endpoint>复制</button>
            </div>
            ${phoneOrigin ? `<small>手机访问地址：${phoneOrigin}</small>` : ''}
          </label>
          <p class="settings-note">快捷指令：新建快捷指令 → 开启「在共享表单中显示」（接收 URL、文本）→ 添加「获取 URL 内容」→ 方法 POST、请求体选「文本」、内容选「快捷指令输入」→ 保存即可在分享菜单中使用。</p>
          <div class="form-actions">
            <button class="btn ghost" type="button" data-collect-test>测试连接</button>
            <span class="spacer"></span>
            <span class="settings-note" id="collectStatus"></span>
          </div>
          <p class="settings-note">在手机上打开这个设置页点「测试连接」，才能验证手机到电脑是否连通。部分平台会限制抓取标题和封面，但链接仍会保存。</p>
        </section>

        <section class="settings-group">
          <h3>自动归类规则</h3>
          ${rulesMarkup(rules)}
          <p class="settings-note">想调整规则，可编辑 server/classifier.js 顶部的词表，重启后生效。</p>
        </section>

        <section class="settings-group">
          <h3>数据与备份</h3>
          <p class="settings-note">文件存放在本机 data/files，索引在 data/db.json。备份时直接复制整个 data 文件夹即可。</p>
          <p class="settings-note">当前没有访问密码，同一 Wi-Fi 下的其他人也可能打开本页面，请勿在公共网络使用。</p>
        </section>
      </form>
    </aside>
  </div>`;

  document.body.classList.add('modal-open');

  const backdrop = drawerRoot.querySelector('.drawer-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeDrawer();
  });
  drawerRoot.querySelectorAll('[data-settings-close]').forEach((element) => {
    element.addEventListener('click', closeDrawer);
  });

  escapeHandler = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeDrawer();
    }
  };
  document.addEventListener('keydown', escapeHandler);

  const monet = window.RHMonet;
  const seedRow = drawerRoot.querySelector('#seedRow');
  const seedStatus = drawerRoot.querySelector('#seedStatus');
  const markSeed = () => {
    const current = monet?.getSeed() || '';
    seedRow?.querySelectorAll('[data-seed]').forEach((element) => {
      element.classList.toggle('active', element.dataset.seed === current);
    });
  };
  markSeed();

  seedRow?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-seed]');
    if (!button || !monet) return;
    monet.setSeed(button.dataset.seed);
    markSeed();
    seedStatus.textContent = button.dataset.seed ? '已应用，可继续点选或换一张图' : '已恢复默认配色';
  });

  const seedFile = drawerRoot.querySelector('#seedImage');
  seedFile?.addEventListener('change', async () => {
    const file = seedFile.files?.[0];
    if (!file || !monet) return;
    seedStatus.textContent = '正在从图片取色…';
    try {
      const seed = await monet.extractSeedFromImage(file);
      monet.setSeed(seed);
      markSeed();
      seedStatus.textContent = `已从图片取色 ${seed}`;
      toast('已按图片颜色生成整套配色', { type: 'success' });
    } catch (error) {
      seedStatus.textContent = error.message;
      toast(error.message, { type: 'error' });
    } finally {
      seedFile.value = '';
    }
  });

  const form = drawerRoot.querySelector('#settingsForm');
  const status = drawerRoot.querySelector('#aiStatus');
  const keyInput = form.elements.apiKey;
  const keyHint = drawerRoot.querySelector('#keyHint');

  drawerRoot.querySelector('[data-copy-endpoint]')?.addEventListener('click', async () => {
    const field = drawerRoot.querySelector('#collectEndpoint');
    try {
      await navigator.clipboard.writeText(field.value);
      toast('收藏接口地址已复制', { type: 'success' });
    } catch {
      field.select();
      toast('长按已选中的地址复制', { type: 'info' });
    }
  });

  drawerRoot.querySelector('[data-offline-prefetch]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '缓存中…';
    try {
      const count = await prefetchOffline(state.files);
      toast(count ? `已缓存 ${count} 个收藏/最近文件，可离线查看` : '没有收藏或最近浏览的文件可缓存', {
        type: count ? 'success' : 'info',
        duration: 4000,
      });
      const status = drawerRoot.querySelector('#offlineStatus');
      if (status) status.textContent = offlineStatusText();
    } catch (error) {
      toast(error.message, { type: 'error' });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  const autoCacheInput = form.elements.autoCache;
  autoCacheInput?.addEventListener('change', async () => {
    const enabled = autoCacheInput.checked;
    setAutoCacheEnabled(enabled);
    const status = drawerRoot.querySelector('#offlineStatus');
    if (!enabled) {
      if (status) status.textContent = offlineStatusText();
      toast('已关闭自动缓存，已缓存的文件仍可离线查看', { type: 'info' });
      return;
    }

    autoCacheInput.disabled = true;
    try {
      const count = await autoCache(state.files, { force: true });
      if (status) status.textContent = offlineStatusText();
      toast(count ? `已自动缓存 ${count} 个文件，可离线查看` : '缓存已是最新', {
        type: 'success',
        duration: 4000,
      });
    } catch (error) {
      toast(error.message, { type: 'error' });
    } finally {
      autoCacheInput.disabled = false;
    }
  });

  drawerRoot.querySelector('[data-collect-test]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    const status = drawerRoot.querySelector('#collectStatus');
    button.disabled = true;
    button.textContent = '测试中…';
    status.textContent = '';
    try {
      await api.collectPing();
      status.textContent = '服务正常';
      toast('收藏接口可用，可以继续配置快捷指令', { type: 'success' });
    } catch (error) {
      status.textContent = '连接失败';
      toast(`连接失败：${error.message}`, { type: 'error', duration: 4800 });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  drawerRoot.querySelector('[data-key-clear]').addEventListener('click', () => {
    cleared = true;
    keyInput.value = '';
    keyInput.placeholder = '保存后将清除已保存的 Key';
    status.textContent = '已标记清除，点击保存生效。';
  });

  keyInput.addEventListener('input', () => {
    if (cleared) {
      cleared = false;
      keyInput.placeholder = '粘贴你的 API Key';
      status.textContent = '';
    }
  });

  const collect = () => {
    const patch = {
      ai: {
        enabled: form.elements.enabled.checked,
        baseURL: form.elements.baseURL.value.trim(),
        model: form.elements.model.value.trim(),
        autoSummaryOnUpload: form.elements.autoSummary.checked,
        autoClassifyOnUpload: form.elements.autoClassify.checked,
      },
    };
    if (cleared) patch.ai.apiKey = null;
    else if (keyInput.value.trim()) patch.ai.apiKey = keyInput.value.trim();
    return patch;
  };

  const save = async () => {
    const updated = await api.saveSettings(collect());
    settings = updated;
    cleared = false;
    keyInput.value = '';
    hasApiKeyState(updated);
    setState({ settings: updated });
    return updated;
  };

  const hasApiKeyState = (updated) => {
    keyInput.placeholder = updated.hasApiKey ? '已保存，留空不修改' : '粘贴你的 API Key';
    keyHint.textContent = updated.hasApiKey
      ? `当前已保存：${updated.ai.apiKey}`
      : '密钥只保存在本机 data/settings.json 中。';
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      await save();
      closeDrawer();
      toast('设置已保存', { type: 'success' });
    } catch (error) {
      toast(error.message, { type: 'error', duration: 4500 });
      status.textContent = error.message;
      button.disabled = false;
      button.textContent = '保存设置';
    }
  });

  drawerRoot.querySelector('[data-ai-classify]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '整理中…';
    status.textContent = '';
    try {
      await save();
      const result = await api.classifyUnfiled();
      await refreshAll();
      status.textContent = result.total
        ? `已整理 ${result.changed}/${result.total} 个文件`
        : '没有需要整理的未分类文件';
      toast(result.changed ? `AI 已整理 ${result.changed} 个文件` : '没有需要整理的文件', {
        type: result.changed ? 'success' : 'info',
      });
    } catch (error) {
      status.textContent = error.message;
      toast(error.message, { type: 'error', duration: 4800 });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  drawerRoot.querySelector('[data-ai-test]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '测试中…';
    status.textContent = '';
    try {
      await save();
      await api.testAI();
      status.textContent = '连接成功，AI 可用。';
      toast('AI 连接成功', { type: 'success' });
    } catch (error) {
      status.textContent = error.message;
      toast(error.message, { type: 'error', duration: 4800 });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}
