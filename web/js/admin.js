/**
 * 管理后台逻辑 v3
 * - 子选项卡：作品展示 / 活动相册 / CMS 设置
 * - 作品管理（上传/归档/恢复/删除）
 * - 活动相册管理（CMS 驱动，本地增强：启用/禁用）
 * - CMS 配置（API Key/连接测试/同步）
 * - 异步抠图触发
 */
// ===== 全局状态 =====
let artworks = [];         // 全部作品（含本地 + CMS）
let bgConfig = { filename: null, url: null, position: 'center', scale: 'cover' };
let pendingFiles = [];
let videos = [];
let stats = { total: 0, active: 0, archived: 0 };
let albums = [];           // CMS 活动相册列表
let currentDisplayAlbumId = null; // 当前展示相册
let currentAlbumId = null; // 当前打开的相册 ID

// ===== 抠图队列状态 =====
let cutoutQueueData = [];
let cutoutFilter = 'all';
let cutoutPage = 1;
const CUTOUT_PAGE_SIZE = 10;

// ===== DOM 引用 =====
const socket = io();
const artworkGrid = document.getElementById('artwork-grid');
const archivedGrid = document.getElementById('archived-grid');
const uploadZone = document.getElementById('upload-zone');
const artworkUpload = document.getElementById('artwork-upload');
const uploadForm = document.getElementById('upload-form');
const pendingList = document.getElementById('pending-list');
const pendingCount = document.getElementById('pending-count');
const connStatus = document.getElementById('connection-status');
const toastEl = document.getElementById('toast');
const bgPreview = document.getElementById('bg-preview');
const uploadSection = document.getElementById('upload-section');

// ===== Socket 连接状态 =====
socket.on('connect', () => {
  connStatus.textContent = '● 已连接';
  connStatus.className = 'status-dot connected';
});
socket.on('disconnect', () => {
  connStatus.textContent = '● 已断开';
  connStatus.className = 'status-dot disconnected';
});

// 初始同步
socket.on('sync', (data) => {
  bgConfig = data.background || bgConfig;
  videos = data.videos || [];
  renderBackground();
  renderVideos();
});

// 实时更新
socket.on('artwork:new', (artwork) => {
  if (artworks.find(a => a.id === artwork.id)) return;
  artworks.push(artwork);
  updateStats();
  renderCurrentTab();
});
socket.on('artworks:batch', (list) => {
  artworks.push(...list);
  updateStats();
  renderCurrentTab();
});
socket.on('artwork:archive', ({ id }) => {
  const a = artworks.find(x => x.id === id);
  if (a) { a.status = 'archived'; a.archivedAt = Date.now(); }
  updateStats();
  renderCurrentTab();
});
socket.on('artwork:restore', ({ id, artwork }) => {
  const idx = artworks.findIndex(x => x.id === id);
  if (idx !== -1) artworks[idx] = artwork;
  else artworks.push(artwork);
  updateStats();
  renderCurrentTab();
});
socket.on('artwork:purge', ({ id }) => {
  artworks = artworks.filter(a => a.id !== id);
  updateStats();
  renderCurrentTab();
});
socket.on('background:update', (bg) => {
  bgConfig = bg;
  renderBackground();
});

// 抠图完成 → 更新作品路径
socket.on('artwork:update', ({ id, url }) => {
  const a = artworks.find(x => x.id === id);
  if (a) a.url = url;
});

// ===== PageFire =====
let pagefireStatus = 'idle';
socket.on('pagefire:deploy-done', ({ success }) => {
  pagefireStatus = success ? 'done' : 'idle';
  updatePagefireBadge();
  if (success) showToast('作品页已同步到公网');
  else showToast('公网同步失败');
});
function updatePagefireBadge() {
  const badge = document.getElementById('pagefire-badge');
  if (!badge) return;
  badge.textContent = pagefireStatus === 'deploying' ? '⏳ 同步中...' : '✅ 已同步';
  badge.className = 'pf-badge ' + (pagefireStatus === 'deploying' ? 'deploying' : 'done');
}

// ===== 统计 =====
function loadStats() {
  fetch('/api/artworks/stats')
    .then(r => r.json())
    .then(d => {
      stats = d;
      renderStats();
    })
    .catch(() => {});
}

function updateStats() {
  stats.active = artworks.filter(a => a.status === 'active').length;
  stats.archived = artworks.filter(a => a.status === 'archived').length;
  stats.total = artworks.length;
  renderStats();
}

function renderStats() {
  document.getElementById('stat-total').querySelector('.stat-value').textContent = stats.total;
  document.getElementById('stat-active').querySelector('.stat-value').textContent = stats.active;
  document.getElementById('stat-archived').querySelector('.stat-value').textContent = stats.archived;
  document.getElementById('tab-active-count').textContent = stats.active;
}

function renderCurrentTab() { renderActiveArtworks(); }

// 设置面板 - 独立页面
function toggleSettings() {
  var panel = document.getElementById('panel-settings');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) { loadCmsConfig(); refreshCutoutStatus(); }
}

// 检测是否为设置页面
(function() {
  if (location.pathname === '/admin/settings') {
    document.getElementById('panel-works').classList.add('hidden');
    document.getElementById('panel-settings').classList.remove('hidden');
    document.getElementById('page-title').textContent = '⚙️ 设置';
    loadCmsConfig();
    refreshCutoutStatus();
    var h2 = document.querySelector('.panel.artwork-panel h2');
    if (h2) {
      var a = document.createElement('a');
      a.href = '/admin'; a.textContent = '← 返回'; a.style.cssText = 'font-size:12px;color:#8a7a5e;text-decoration:none;margin-left:auto';
      h2.querySelector('span:last-child').appendChild(a);
    }
  }
})();

// ===== 渲染展示相册的作品 =====
function renderActiveArtworks() {
  populateDisplayAlbumSelect();
  if (!currentDisplayAlbumId) {
    artworkGrid.innerHTML = '<div class="grid-empty">请先选择展示相册</div>';
    document.getElementById('stat-total').querySelector('.stat-value').textContent = '0';
    document.getElementById('stat-active').querySelector('.stat-value').textContent = '0';
    return;
  }
  const list = artworks.filter(a => a.status === 'active' && String(a.albumId) === String(currentDisplayAlbumId));
  document.getElementById('stat-total').querySelector('.stat-value').textContent = artworks.filter(a => String(a.albumId) === String(currentDisplayAlbumId)).length;
  document.getElementById('stat-active').querySelector('.stat-value').textContent = list.length;
  if (list.length === 0) {
    artworkGrid.innerHTML = '<div class="grid-empty">该相册暂无作品</div>';
    return;
  }
  artworkGrid.innerHTML = list.map(function(a) {
    var albumName = a.albumName || (albums.find(function(al) { return String(al.albumId) === String(a.albumId); })?.albumName) || '';
    var hasCutout = !!a.cutoutUrl;
    return '<div class="artwork-item" onclick="previewArtwork(\'' + a.id + '\')">'
      + '<div style="position:relative">'
      + '<img src="' + a.displayUrl + '" alt="' + escapeAttr(a.name) + '" loading="lazy" id="thumb-' + a.id + '">'
      + (hasCutout ? '<span class="cutout-badge" onclick="event.stopPropagation();toggleCutout(\'' + a.id + '\')" style="position:absolute;bottom:4px;right:4px;font-size:10px;background:rgba(0,0,0,.5);color:#fff;padding:2px 8px;border-radius:8px;cursor:pointer">✂️ 抠图</span>' : '')
      + '</div>'
      + '<div class="item-info"><div class="item-name">' + escapeHtml(a.name) + '</div>'
      + '<div class="item-date">' + escapeHtml(a.date) + (albumName ? ' · 📁 ' + escapeHtml(albumName) : '') + '</div></div>'
      + '<button class="copy-link-btn" onclick="event.stopPropagation(); copyWorkLink(\'' + a.id + '\')">📋 作品页</button>'
      + '<button class="btn-archive" onclick="event.stopPropagation(); archiveArtwork(\'' + a.id + '\')">📦 下架</button>'
      + '</div>';
  }).join('');
}

var cutoutToggle = {};
function toggleCutout(id) {
  var a = artworks.find(function(x) { return x.id === id; });
  if (!a || !a.cutoutUrl) return;
  var show = !cutoutToggle[id];
  cutoutToggle[id] = show;
  var img = document.getElementById('thumb-' + id);
  if (img) img.src = show ? a.cutoutUrl : a.displayUrl;
  var badge = img && img.parentNode && img.parentNode.querySelector('.cutout-badge');
  if (badge) badge.textContent = show ? '📷 展示' : '✂️ 抠图';
}

function populateDisplayAlbumSelect() {
  const sel = document.getElementById('display-album-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— 请选择 —</option>';
  albums.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.albumId;
    const count = artworks.filter(w => String(w.albumId) === String(a.albumId)).length;
    opt.textContent = (a.albumName || '未命名') + (count ? ' (' + count + ' 件)' : '');
    sel.appendChild(opt);
  });
  if (currentDisplayAlbumId) sel.value = currentDisplayAlbumId;
}

function switchDisplayAlbum(albumId) {
  currentDisplayAlbumId = albumId || null;
  // 保存到服务端
  fetch('/api/cms/display-album', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumId: currentDisplayAlbumId })
  }).catch(() => {});
  loadWorksFromCms();
}

// ===== 渲染归档作品 =====
function renderArchivedArtworks() {
  const archived = artworks.filter(a => a.status === 'archived');
  if (archived.length === 0) {
    archivedGrid.innerHTML = '<div class="grid-empty">还没有归档作品</div>';
    return;
  }
  archivedGrid.innerHTML = archived.map(a => `
    <div class="artwork-item archived" onclick="previewArtwork('${a.id}')">
      <img src="${a.url}" alt="${escapeAttr(a.name)}" loading="lazy" style="opacity:0.5;">
      <div class="item-info">
        <div class="item-name">${escapeHtml(a.name)}</div>
        <div class="item-date">${escapeHtml(a.date)} · 已归档</div>
      </div>
      <button class="btn-restore" onclick="event.stopPropagation(); restoreArtwork('${a.id}')" title="重新上架">↩ 上架</button>
      <button class="btn-purge" onclick="event.stopPropagation(); purgeArtwork('${a.id}')" title="彻底删除">✕ 删除</button>
    </div>
  `).join('');
}

// ===== 操作函数 =====
function archiveArtwork(id) {
  fetch(`/api/artworks/${id}/archive`, { method: 'PUT' })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        const a = artworks.find(x => x.id === id);
        if (a) { a.status = 'archived'; a.archivedAt = Date.now(); }
        updateStats();
        renderCurrentTab();
        showToast('已下架归档');
      }
    });
}

function restoreArtwork(id) {
  fetch(`/api/artworks/${id}/restore`, { method: 'PUT' })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        const idx = artworks.findIndex(x => x.id === id);
        if (idx !== -1) artworks[idx] = data.artwork;
        updateStats();
        renderCurrentTab();
        showToast('已重新上架');
      }
    });
}

function purgeArtwork(id) {
  const a = artworks.find(x => x.id === id);
  const name = a ? a.name : '该作品';
  showConfirm(`⚠️ 确定彻底删除"${name}"吗？\n\n此操作将永久删除作品文件和数据，不可恢复！`, () => {
    fetch(`/api/artworks/${id}/purge`, { method: 'DELETE' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          artworks = artworks.filter(a => a.id !== id);
          updateStats();
          renderCurrentTab();
          showToast('已彻底删除');
        }
      });
  });
}

function archiveAll() {
  if (!currentDisplayAlbumId) return;
  const list = artworks.filter(a => a.status === 'active' && String(a.albumId) === String(currentDisplayAlbumId));
  if (list.length === 0) return;
  const promises = list.map(a => fetch(`/api/artworks/${a.id}/archive`, { method: 'PUT' }));
  Promise.all(promises).then(() => {
    artworks.forEach(a => { if (a.status === 'active') a.status = 'archived'; });
    updateStats(); loadWorksFromCms();
    showToast(`已下架 ${list.length} 幅作品`);
  });
}

function purgeAllArchived() {
  const archived = artworks.filter(a => a.status === 'archived');
  if (archived.length === 0) return;
  showConfirm(`⚠️ 确定彻底删除全部 ${archived.length} 幅归档作品吗？\n\n此操作不可恢复！`, () => {
    const promises = archived.map(a =>
      fetch(`/api/artworks/${a.id}/purge`, { method: 'DELETE' })
    );
    Promise.all(promises).then(() => {
      artworks = artworks.filter(a => a.status !== 'archived');
      updateStats();
      renderCurrentTab();
      showToast(`已删除 ${archived.length} 幅归档作品`);
    });
  });
}

// ===== 作品上传 =====
uploadZone.addEventListener('click', () => artworkUpload.click());
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length > 0) showUploadForm(files);
});
artworkUpload.addEventListener('change', (e) => {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
  if (files.length > 0) showUploadForm(files);
  e.target.value = '';
});

function showUploadForm(files) {
  pendingFiles = files;
  pendingCount.textContent = files.length;
  uploadForm.classList.remove('hidden');
  // 弹出上传表单时填充相册下拉列表，默认选中当前筛选的相册
  populateAlbumSelect(activeAlbumFilter);
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  pendingList.innerHTML = '';
  files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'pending-item';
    const reader = new FileReader();
    reader.onload = (e) => { item.querySelector('img').src = e.target.result; };
    reader.readAsDataURL(file);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    item.innerHTML = `
      <img src="" alt="预览">
      <input type="text" class="name-input" placeholder="小画家名字" value="${escapeAttr(baseName)}" data-index="${i}">
      <input type="text" class="date-input" placeholder="日期" value="${todayStr}" data-index="${i}" maxlength="8">
    `;
    pendingList.appendChild(item);
  });
}

function useDefaultInfo() {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  document.querySelectorAll('.name-input').forEach(inp => inp.value = '匿名小画家');
  document.querySelectorAll('.date-input').forEach(inp => inp.value = todayStr);
}

function cancelBatchUpload() {
  pendingFiles = [];
  pendingList.innerHTML = '';
  uploadForm.classList.add('hidden');
}

// ===== 相册选择下拉列表 =====
function populateAlbumSelect(preselectAlbumId) {
  const sel = document.getElementById('album-select');
  if (!sel) return;
  const currentVal = preselectAlbumId || sel.value;
  sel.innerHTML = '<option value="">— 请选择相册 —</option>';
  const enabledAlbums = albums.filter(a => a.enabled !== false);
  if (!enabledAlbums.length) {
    sel.innerHTML += '<option value="" disabled>暂无可用相册，请先创建</option>';
    return;
  }
  enabledAlbums.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.albumId;
    opt.textContent = (a.albumName || '未命名') + ' (' + (a.mediaCount || a.medias?.length || 0) + ' 件)';
    sel.appendChild(opt);
  });
  if (currentVal) sel.value = currentVal;
}

// 作品展示数据从 CMS 相册加载
function loadWorksFromCms() {
  fetch('/api/cms/albums?pageSize=100')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.success) { renderActiveArtworks(); return null; }
      var rows = d.data?.rows || [];
      albums = rows.map(function(a) { return { ...a, albumId: a.albumId || a.id }; });
      populateDisplayAlbumSelect();
      var promises = rows.map(function(a) {
        return fetch('/api/cms/albums/' + a.albumId + '/media?pageSize=200')
          .then(function(r) { return r.json(); })
          .then(function(md) { return (md.data?.rows || []).map(function(m) { return {
            id: 'cms_' + m.mediaId, name: m.localName || m.mediaName || '匿名小画家',
            date: m.createTime ? m.createTime.slice(0,10).replace(/-/g,'') : '',
            displayUrl: m.mediaUrl, cutoutUrl: m.cutoutUrl || null,
            url: m.cutoutUrl || m.mediaUrl, originalUrl: m.sourceUrl || m.mediaUrl,
            albumId: a.albumId, albumName: a.albumName || '',
            status: m.enabled !== false ? 'active' : 'archived', isCms: true,
            mediaId: m.mediaId, enabled: m.enabled !== false
          };}); })
          .catch(function() { return []; });
      });
      return Promise.all(promises);
    })
    .then(function(nested) {
      if (!nested) return;
      artworks = nested.flat();
      updateStats();
      renderActiveArtworks();
    })
    .catch(function() { renderActiveArtworks(); });
}

// ===== 背景图管理 =====
document.getElementById('bg-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  uploadBackground(file);
  e.target.value = '';
});

function uploadBackground(file) {
  const formData = new FormData();
  formData.append('image', file);
  const progress = document.getElementById('bg-upload-progress');
  progress.className = 'upload-progress';
  progress.textContent = '正在上传背景图...';
  fetch('/api/background/upload', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        bgConfig = data.background;
        renderBackground();
        progress.className = 'upload-progress success';
        progress.textContent = '✓ 背景图上传成功！';
        showToast('背景图已更新');
        setTimeout(() => progress.classList.add('hidden'), 2000);
      } else {
        throw new Error(data.error);
      }
    })
    .catch(err => {
      progress.className = 'upload-progress error';
      progress.textContent = '✗ 上传失败: ' + err.message;
      setTimeout(() => progress.classList.add('hidden'), 3000);
    });
}

function updateBgScale(scale) {
  document.querySelectorAll('[data-scale]').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-scale="${scale}"]`).classList.add('active');
  bgConfig.scale = scale;
  fetch('/api/background', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scale }) });
  renderBackground();
}

function updateBgPosition(pos) {
  document.querySelectorAll('[data-pos]').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-pos="${pos}"]`).classList.add('active');
  bgConfig.position = pos;
  fetch('/api/background', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: pos }) });
  renderBackground();
}

function renderBackground() {
  if (bgConfig.url) {
    bgPreview.style.backgroundImage = `url('${bgConfig.url}')`;
    bgPreview.style.backgroundSize = bgConfig.scale || 'cover';
    bgPreview.style.backgroundPosition = bgConfig.position || 'center';
    const name = bgConfig.cmsUrl ? '☁️ CMS' : (bgConfig.filename || '');
    bgPreview.innerHTML = name ? '<div class="bg-label" style="position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,.5);color:#fff;padding:2px 10px;border-radius:4px;font-size:11px">' + escapeHtml(name) + '</div>' : '';
  } else {
    bgPreview.style.backgroundImage = '';
    bgPreview.innerHTML = '<div class="bg-placeholder">暂无背景图，点击上方上传</div>';
  }
  document.querySelectorAll('[data-scale]').forEach(b => b.classList.toggle('active', b.dataset.scale === (bgConfig.scale || 'cover')));
  document.querySelectorAll('[data-pos]').forEach(b => b.classList.toggle('active', b.dataset.pos === (bgConfig.position || 'center')));
}

// ===== 确认弹窗 =====
let confirmCallback = null;
function showConfirm(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-modal').classList.remove('hidden');
  confirmCallback = cb;
}
function closeConfirm() {
  document.getElementById('confirm-modal').classList.add('hidden');
  confirmCallback = null;
}
document.getElementById('confirm-ok').addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  closeConfirm();
});
document.getElementById('confirm-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeConfirm();
});

// ===== 预览弹窗（Tab 切换：展示图 / 抠图 / 原图）=====
function previewArtwork(id) {
  var a = artworks.find(function(x) { return x.id === id; });
  if (!a) return;
  var img = document.getElementById("preview-img");
  var nameEl = document.getElementById("preview-name");
  var dateEl = document.getElementById("preview-date");
  var tabsEl = document.getElementById("preview-tabs");
  if (!img || !tabsEl) return;
  // 构建 tab 列表
  var modes = [];
  if (a.displayUrl || a.url) modes.push({ key: "display", label: "📷 展示图", url: a.displayUrl || a.url });
  if (a.cutoutUrl) modes.push({ key: "cutout", label: "✂️ 抠图版", url: a.cutoutUrl });
  if (a.originalUrl && a.originalUrl !== (a.displayUrl || a.url)) modes.push({ key: "original", label: "🖼️ 原图", url: a.originalUrl });
  if (a.sourceUrl && !modes.find(function(m) { return m.url === a.sourceUrl; })) modes.push({ key: "source", label: "📄 源文件", url: a.sourceUrl });
  // 显示第一个
  var currentIdx = 0;
  img.src = modes[0].url;
  nameEl.textContent = a.name;
  dateEl.textContent = (a.date || "") + (a.status === "archived" ? " · 已归档" : "");
  // 渲染 Tab
  tabsEl.innerHTML = modes.map(function(m, i) {
    var cls = i === 0 ? 'preview-tab active' : 'preview-tab';
    return '<span class="' + cls + '" data-idx="' + i + '">' + m.label + '</span>';
  }).join('');
  // 修正 active class（上面 map 里不能用 class 覆盖掉原有的）
  var tabs = tabsEl.querySelectorAll(".preview-tab");
  if (tabs.length > 0) tabs[0].classList.add("active");
  // Tab 点击切换
  tabsEl.onclick = function(e) {
    var tab = e.target.closest(".preview-tab");
    if (!tab) return;
    var idx = parseInt(tab.getAttribute("data-idx"));
    if (isNaN(idx) || idx === currentIdx) return;
    currentIdx = idx;
    img.src = modes[idx].url;
    tabs.forEach(function(t) { t.classList.remove("active"); });
    tab.classList.add("active");
  };
  document.getElementById("preview-modal").classList.remove("hidden");
}
function closePreview(e) {
  if (!e || e.target === e.currentTarget) {
    document.getElementById("preview-modal").classList.add("hidden");
  }
}
// 键盘左右键切换预览
document.addEventListener("keydown", function(e) {
  var modal = document.getElementById("preview-modal");
  if (modal.classList.contains("hidden")) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    var tabs = document.querySelectorAll("#preview-tabs .preview-tab");
    var active = document.querySelector("#preview-tabs .preview-tab.active");
    if (!tabs.length || !active) return;
    var idx = Array.from(tabs).indexOf(active);
    if (e.key === "ArrowLeft" && idx > 0) tabs[idx - 1].click();
    if (e.key === "ArrowRight" && idx < tabs.length - 1) tabs[idx + 1].click();
  }
  if (e.key === "Escape") { closePreview(); }
});
// ===== 复制链接 =====
function copyWorkLink(id) {
  const extInput = document.getElementById('external-base-url');
  const base = extInput && extInput.value.trim() ? extInput.value.trim().replace(/\/+$/, '') : window.location.origin;
  const idSafe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const url = base + '/works/' + idSafe + '.html';
  navigator.clipboard.writeText(url).then(() => {
    showToast('作品页链接已复制');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('作品页链接已复制');
  });
}

// ===== 外部地址 =====
const PAGEFIRE_URL = 'https://17xskj-daxiang.pagefire.openhkt.com';
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('externalBaseUrl');
  const el = document.getElementById('external-base-url');
  if (!el) return;
  el.value = saved || PAGEFIRE_URL;
  if (!saved) localStorage.setItem('externalBaseUrl', PAGEFIRE_URL);
});
document.getElementById('ext-url-save').addEventListener('click', () => {
  const input = document.getElementById('external-base-url');
  const val = input.value.trim();
  if (val) {
    localStorage.setItem('externalBaseUrl', val);
    const status = document.getElementById('ext-url-status');
    status.textContent = '已保存';
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2000);
  }
});

// ===== Toast =====
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toastEl.classList.add('hidden'), 2500);
}

// ===== 工具函数 =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

// ===== 视频管理 =====
const videoUpload = document.getElementById('video-upload');
const videoList = document.getElementById('video-list');

socket.on('videos:update', (list) => {
  videos = list;
  renderVideos();
});
videoUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  uploadVideoFile(file);
  e.target.value = '';
});

function uploadVideoFile(file) {
  const formData = new FormData();
  formData.append('video', file);
  formData.append('name', file.name.replace(/\.[^.]+$/, ''));
  formData.append('date', new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const progress = document.getElementById('video-upload-progress');
  progress.className = 'upload-progress';
  progress.textContent = '正在上传视频...';
  fetch('/api/videos/upload', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        videos.push(data.video);
        renderVideos();
        progress.className = 'upload-progress success';
        progress.textContent = '✓ 视频上传成功！';
        showToast('视频已添加到插播列表');
        setTimeout(() => progress.classList.add('hidden'), 2000);
      } else { throw new Error(data.error); }
    })
    .catch(err => {
      progress.className = 'upload-progress error';
      progress.textContent = '✗ 上传失败: ' + err.message;
      setTimeout(() => progress.classList.add('hidden'), 3000);
    });
}

function deleteVideo(id) {
  showConfirm('确定删除这个视频吗？', () => {
    fetch(`/api/videos/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          videos = videos.filter(v => v.id !== id);
          renderVideos();
          showToast('视频已删除');
        }
      });
  });
}

function renderVideos() {
  if (videos.length === 0) {
    videoList.innerHTML = '<div class="grid-empty">还没有视频</div>';
    return;
  }
  videoList.innerHTML = videos.map(v => `
    <div class="video-item">
      <div class="video-icon">🎬</div>
      <div class="video-info">
        <div class="video-name">${escapeHtml(v.name)}</div>
        <div class="video-meta">${escapeHtml(v.date)}</div>
      </div>
      <button class="video-delete" onclick="deleteVideo('${v.id}')" title="删除">✕</button>
    </div>
  `).join('');
}

function updateVideoConfig() {
  const interval = parseInt(document.getElementById('video-interval').value) || 300;
  const repeat = parseInt(document.getElementById('video-repeat').value) || 2;
  fetch('/api/videos/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interval, repeat })
  });
}

// ===== 初始加载 =====
loadCmsConfig();

function initAlbums() {
  fetch('/api/cms/albums?pageSize=100')
    .then(r => r.json())
    .then(d => {
      if (d.success) albums = (d.data?.rows || []).map(a => ({ ...a, albumId: a.albumId || a.id }));
    })
    .catch(() => {})
    .then(() => fetch('/api/cms/display-album'))
    .then(r => r.json())
    .then(d => {
      if (d.albumId) { currentDisplayAlbumId = d.albumId; loadWorksFromCms(); }
      else renderActiveArtworks();
    })
    .catch(() => renderActiveArtworks());
}
initAlbums();

// 定时检查 CMS 新增媒体（每 30 秒）
var cmsSinceMap = {};
function startCmsPolling() {
  setInterval(function() {
    if (!currentDisplayAlbumId) return;
    var sinceId = cmsSinceMap[currentDisplayAlbumId] || 0;
    fetch('/api/cms/albums/' + currentDisplayAlbumId + '/media/check?sinceId=' + sinceId + '&limit=20')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.success || !d.data || !d.data.length) return;
        var newMedias = d.data;
        var maxId = sinceId;
        newMedias.forEach(function(m) {
          var mid = parseInt(m.mediaId || m.id);
          if (mid > maxId) maxId = mid;
          if (!m.cutoutUrl) {
            fetch('/api/cms/cutout/' + currentDisplayAlbumId + '/' + mid, { method: 'POST' }).catch(function(){});
          }
        });
        cmsSinceMap[currentDisplayAlbumId] = maxId;
        loadWorksFromCms();
      })
      .catch(function() {});
  }, 30000);
}
startCmsPolling();

fetch('/api/background').then(r => r.json()).then(d => {
  bgConfig = d;
  renderBackground();
}).catch(() => {});

fetch('/api/videos/config').then(r => r.json()).then(cfg => {
  document.getElementById('video-interval').value = cfg.interval || 300;
  document.getElementById('video-repeat').value = cfg.repeat || 2;
}).catch(() => {});

// Rembg 健康检测和抠图队列自动刷新（仅切到抠图面板时更新）
setInterval(function() {
  var panel = document.getElementById('panel-cutout');
  if (panel && !panel.classList.contains('hidden')) {
    checkRembgHealth();
    refreshCutoutStatus();
  }
}, 30000);

  // Rembg 健康检测（顶部常驻指示灯）
  checkRembgHealth();
  setInterval(checkRembgHealth, 30000);
// ================================================
// 子选项卡切换
// ================================================
function switchSubTab(tab) {
  activeSubTab = tab;
  document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.sub-tab-btn[data-tab="${tab}"]`).classList.add('active');
  ['works','albums','settings'].forEach(t => {
    const el = document.getElementById('subtab-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'albums' && albums.length === 0 && !albums._loading) loadAlbums();
}

// ================================================
// CMS 配置管理
// ================================================
let cmsConfigured = false;

function loadCmsConfig() {
  fetch('/api/cms/config')
    .then(r => r.json())
    .then(d => {
      cmsConfigured = d.configured;
      updateCmsBadge();
      if (d.apiBase) document.getElementById('cms-api-base').value = d.apiBase;
      if (d.configured) {
        document.getElementById('cms-status-text').textContent = '✅ 已配置 (密钥: ' + d.apiKeyPrefix + ')';
        document.getElementById('cms-status-text').style.color = '#27ae60';
      }
    })
    .catch(() => {});
}

function updateCmsBadge() {
  const badge = document.getElementById('cms-badge');
  if (!badge) return;
  badge.textContent = cmsConfigured ? '☁️ CMS 已连接' : '☁️ CMS 未配置';
  badge.style.background = cmsConfigured ? '#27ae60' : '#999';
}

function saveCmsConfig() {
  const key = document.getElementById('cms-api-key').value.trim();
  const base = document.getElementById('cms-api-base').value.trim();
  fetch('/api/cms/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key || undefined, apiBase: base || undefined })
  })
  .then(r => r.json())
  .then(d => {
    if (d.success) {
      showToast('CMS 配置已保存');
      cmsConfigured = !!key;
      updateCmsBadge();
      if (key) testCmsConnection();
    }
  })
  .catch(err => showToast('保存失败: ' + err.message));
}

function testCmsConnection() {
  const statusEl = document.getElementById('cms-status-text');
  statusEl.textContent = '⏳ 测试中...';
  statusEl.style.color = '#d4840a';
  fetch('/api/cms/test')
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        statusEl.textContent = '✅ 连接成功 - ' + (d.tenant?.platformName || '平台') + ' (tenant: ' + (d.tenant?.tenantId || '').slice(0,8) + '...)';
        statusEl.style.color = '#27ae60';
        cmsConfigured = true;
        updateCmsBadge();
        loadAlbums();
      } else {
        statusEl.textContent = '❌ 连接失败: ' + d.error;
        statusEl.style.color = '#e74c3c';
      }
    })
    .catch(err => {
      statusEl.textContent = '❌ 请求失败: ' + err.message;
      statusEl.style.color = '#e74c3c';
    });
}

function toggleApiKeyVisibility() {
  const inp = document.getElementById('cms-api-key');
  const btn = document.getElementById('key-toggle-btn');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    btn.textContent = '👁️';
  }
}

// ================================================
// 活动相册管理
// ================================================
function loadAlbums() {
  const badge = document.getElementById('album-source-badge');
  if (badge) badge.textContent = '⏳ 加载中...';
  fetch('/api/cms/albums?pageSize=100')
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        albums = (d.data?.rows || []).map(a => ({ ...a, albumId: a.albumId || a.id }));
        populateDisplayAlbumSelect();
        if (badge) badge.textContent = d.fromCache ? '(缓存)' : '';
      }
    })
    .catch(() => {});
}

function renderAlbums() {
  const grid = document.getElementById('album-grid');
  if (!grid) return;
  if (!albums.length) {
    grid.innerHTML = '<div class="grid-empty">暂无相册，点击"新建相册"开始</div>';
    return;
  }
  grid.innerHTML = albums.map(a => {
    const statusClass = a.enabled !== false ? 'enabled' : 'disabled';
    const statusText = a.enabled !== false ? '已启用' : '已禁用';
    const coverUrl = a.coverImage || (a.medias && a.medias[0]?.mediaUrl) || '';
    return '<div class="album-card" onclick="openAlbum(\'' + a.albumId + '\')">'
      + '<div class="album-cover"' + (coverUrl ? ' style="background-image:url(' + coverUrl + ')"' : '') + '>'
      + '<span class="album-count">' + (a.mediaCount || a.medias?.length || 0) + ' 件</span></div>'
      + '<div class="album-info">'
      + '<div class="album-name">' + escapeHtml(a.albumName || '未命名') + '</div>'
      + '<div class="album-date">' + (a.createTime || a.updatedAt || '') + '</div>'
      + '<span class="album-status ' + statusClass + '">' + statusText + '</span>'
      + '</div></div>';
  }).join('');
}

function createAlbum() {
  document.getElementById('new-album-name').value = '';
  document.getElementById('create-album-modal').classList.remove('hidden');
}
function closeAlbumModal() {
  document.getElementById('create-album-modal').classList.add('hidden');
}
function doCreateAlbum() {
  const name = document.getElementById('new-album-name').value.trim();
  if (!name) { showToast('请输入相册名称'); return; }
  fetch('/api/cms/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumName: name, albumStatus: '1' })
  })
  .then(r => r.json())
  .then(d => {
    if (d.success) {
      showToast('相册创建成功');
      closeAlbumModal();
      loadAlbums();
    } else showToast('创建失败: ' + d.error);
  })
  .catch(err => showToast('创建失败: ' + err.message));
}

function syncAlbums() {
  // 先保存配置（如未保存过）
  const key = document.getElementById('cms-api-key').value.trim();
  if (key) {
    fetch('/api/cms/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    }).catch(() => {});
  }
  // 同步相册
  const badge = document.getElementById('album-source-badge');
  if (badge) badge.textContent = '⏳ 同步中...';
  fetch('/api/cms/sync', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        showToast('同步完成: ' + d.albumsCount + ' 个相册');
      } else showToast('同步失败: ' + d.error);
      loadAlbums();
    })
    .catch(err => { showToast('同步失败: ' + err.message); loadAlbums(); });
}

// ===== 相册详情 =====
function openAlbum(albumId) {
  currentAlbumId = albumId;
  document.getElementById('album-detail').classList.remove('hidden');
  document.getElementById('album-grid').classList.add('hidden');
  loadAlbumDetail(albumId);
}
function closeAlbumDetail() {
  currentAlbumId = null;
  document.getElementById('album-detail').classList.add('hidden');
  document.getElementById('album-grid').classList.remove('hidden');
  renderAlbums();
}

function loadAlbumDetail(albumId) {
  const album = albums.find(a => String(a.albumId) === String(albumId));
  if (album) {
    document.getElementById('album-detail-title').textContent = '📁 ' + (album.albumName || '相册');
    const cb = document.getElementById('album-enable-cb');
    cb.checked = album.enabled !== false;
    document.getElementById('album-enable-label').textContent = album.enabled !== false ? '已启用' : '已禁用';
  }
  // 加载媒体列表
  fetch('/api/cms/albums/' + albumId + '/media?pageSize=200')
    .then(r => r.json())
    .then(d => {
      if (!d.success) { showToast('加载失败: ' + d.error); return; }
      const rows = d.data?.rows || [];
      const grid = document.getElementById('album-media-grid');
      if (!rows.length) {
        grid.innerHTML = '<div class="grid-empty">暂无作品，点击上方"上传作品"添加</div>';
        return;
      }
      grid.innerHTML = rows.map(m => {
        const enabled = m.enabled !== false;
        const hasCutout = !!m.cutoutUrl;
        const safeName = escapeHtml(m.mediaName || '未命名');
        const safeNameAttr = escapeAttr(m.mediaName || '');
        return '<div class="media-item">'
          + '<div class="media-toggle ' + (enabled ? '' : 'off') + '">' + (enabled ? '✓ 展示' : '✕ 隐藏') + '</div>'
          + '<img class="media-thumb" src="' + (m.thumbnailUrl || m.mediaUrl) + '" alt="' + safeNameAttr + '" loading="lazy">'
          + (hasCutout ? '<div class="media-badge-cutout">✂️ 已抠图</div>' : '')
          + '<div class="media-name">' + safeName + '</div>'
          + '<div class="media-actions">'
          + '<button class="media-btn" onclick="event.stopPropagation(); toggleMedia(' + albumId + ',' + m.mediaId + ')" title="' + (enabled ? '禁用' : '启用') + '">' + (enabled ? '✓' : '✕') + '</button>'
          + (!hasCutout ? '<button class="media-btn cutout" onclick="event.stopPropagation(); triggerCutout(' + albumId + ',' + m.mediaId + ')" title="抠图">✂️</button>' : '')
          + '<button class="media-btn delete" onclick="event.stopPropagation(); deleteMedia(' + albumId + ',' + m.mediaId + ', \'' + safeNameAttr + '\')" title="删除">🗑️</button>'
          + '</div></div>';
      }).join('');
    })
    .catch(err => showToast('加载失败: ' + err.message));
}

function toggleMedia(albumId, mediaId) {
  const btn = event.target;
  const isCurrentlyEnabled = btn.textContent.trim() === '✕';
  const enabled = !isCurrentlyEnabled;
  fetch('/api/cms/albums/' + albumId + '/media/' + mediaId + '/enable', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  })
  .then(r => r.json())
  .then(d => {
    if (d.success) {
      const album = albums.find(a => String(a.albumId) === String(albumId));
      if (album && album.medias) {
        const m = album.medias.find(mm => String(mm.mediaId) === String(mediaId));
        if (m) m.enabled = enabled;
      }
      loadAlbumDetail(albumId);
      showToast(enabled ? '已启用' : '已禁用');
    } else showToast('操作失败');
  });
}

function toggleAlbumEnable() {
  if (!currentAlbumId) return;
  const cb = document.getElementById('album-enable-cb');
  const enabled = cb.checked;
  fetch('/api/cms/albums/' + currentAlbumId + '/enable', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  })
  .then(r => r.json())
  .then(d => {
    if (d.success) {
      document.getElementById('album-enable-label').textContent = enabled ? '已启用' : '已禁用';
      const album = albums.find(a => String(a.albumId) === String(currentAlbumId));
      if (album) album.enabled = enabled;
    } else cb.checked = !enabled;
  });
}

function deleteMedia(albumId, mediaId, name) {
  showConfirm('确定从相册中删除 "' + name + '" 吗？\n此操作将从 CMS 中删除该媒体，不可恢复！', () => {
    fetch('/api/cms/albums/' + albumId + '/media/' + mediaId, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          showToast('已删除');
          const album = albums.find(a => String(a.albumId) === String(albumId));
          if (album && album.medias) album.medias = album.medias.filter(m => String(m.mediaId) !== String(mediaId));
          loadAlbumDetail(albumId);
        } else showToast('删除失败: ' + d.error);
      });
  });
}

function triggerCutout(albumId, mediaId) {
  fetch('/api/cms/cutout/' + albumId + '/' + mediaId, { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (d.success) showToast(d.message || '已加入抠图队列');
      else showToast('抠图触发失败: ' + d.error);
      refreshCutoutStatus();
    });
}

function scanAlbumCutout(albumId) {
  fetch('/api/cms/cutout/scan/' + albumId, { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (d.success) showToast('已添加 ' + d.addedToQueue + ' 个媒体到抠图队列');
      refreshCutoutStatus();
    });
}

// ===== 抠图队列管理 =====
function checkRembgHealth() {
  var dot = document.getElementById('rembg-dot');
  var statusText = document.getElementById('rembg-status-text');
  var hDot = document.getElementById('header-rembg-dot');
  var hText = document.getElementById('header-rembg-text');
  var cDot = document.getElementById('cms-rembg-dot');
  var cText = document.getElementById('cms-rembg-text');
  var badge = document.getElementById('rembg-badge');
  fetch('/api/cms/rembg-health')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var cls = '', txt = '';
      if (d.success && d.status === 'ready') { cls = 'ready'; txt = '运行正常'; }
      else if (d.success) { cls = 'loading'; txt = '异常: ' + (d.status || 'unknown'); }
      else { cls = 'unavailable'; txt = '不可用'; }
      if (dot) { dot.className = 'health-dot ' + cls; statusText.textContent = txt; }
      if (hDot) { hDot.className = 'header-health-dot ' + cls; hText.textContent = txt; }
      if (cDot) { cDot.className = 'cms-rembg-dot ' + cls; cText.textContent = txt; cText.style.color = cls === 'ready' ? '#4caf50' : cls === 'loading' ? '#ff9800' : '#f44336'; }
      if (badge) { badge.style.display = ''; badge.style.background = cls === 'ready' ? '#27ae60' : cls === 'loading' ? '#ff9800' : '#f44336'; badge.textContent = cls === 'ready' ? '✂️ 抠图 已连接' : '✂️ 抠图 离线'; }
    })
    .catch(function() {
      if (dot) dot.className = 'health-dot unavailable';
      if (hDot) { hDot.className = 'header-health-dot unavailable'; hText.textContent = '不可用'; }
      if (cDot) { cDot.className = 'cms-rembg-dot unavailable'; cText.textContent = '不可用'; cText.style.color = '#f44336'; }
      if (badge) { badge.style.display = ''; badge.style.background = '#f44336'; badge.textContent = '✂️ 抠图'; }
    });
}
function refreshCutoutStatus() {
  fetch('/api/cms/cutout/queue')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      cutoutQueueData = d.items || [];
      var isProcessing = d.processing || false;
      var pendingItems = cutoutQueueData.filter(function(i) { return i.status === 'pending' || i.status === 'processing'; }).length;
      document.getElementById('cutout-queue-count').textContent = pendingItems;
      document.getElementById('cutout-processing-status').textContent = isProcessing ? '🔄 处理中' : '⏸ 空闲';
      updateFilterCounts();
      renderCutoutQueue();
      updateCutoutPagination();
    })
    .catch(function() {});
}

function updateFilterCounts() {
  var counts = { all: cutoutQueueData.length, pending: 0, processing: 0, done: 0, error: 0 };
  cutoutQueueData.forEach(function(i) { if (counts.hasOwnProperty(i.status)) counts[i.status]++; });
  Object.keys(counts).forEach(function(k) {
    var el = document.getElementById('count-' + k);
    if (el) el.textContent = counts[k];
  });
}

function getFilteredData() {
  if (cutoutFilter === 'all') return cutoutQueueData.slice();
  return cutoutQueueData.filter(function(i) { return i.status === cutoutFilter; });
}

function renderCutoutQueue() {
  var listEl = document.getElementById('cutout-list');
  if (!listEl) return;
  var filtered = getFilteredData();
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="grid-empty">暂无抠图任务</div>';
    return;
  }
  var totalPages = Math.max(1, Math.ceil(filtered.length / CUTOUT_PAGE_SIZE));
  if (cutoutPage > totalPages) cutoutPage = totalPages;
  var start = (cutoutPage - 1) * CUTOUT_PAGE_SIZE;
  var pageItems = filtered.slice(start, start + CUTOUT_PAGE_SIZE);
  var statusMap = {
    pending: { icon: '⏳', text: '排队中', cls: 'status-pending' },
    processing: { icon: '🔄', text: '抠图中', cls: 'status-processing' },
    done: { icon: '✅', text: '已完成', cls: 'status-done' },
    error: { icon: '❌', text: '失败', cls: 'status-error' }
  };
  listEl.innerHTML = pageItems.map(function(item) {
    var st = statusMap[item.status] || { icon: '❓', text: item.status, cls: '' };
    var elapsed = '';
    if (item.doneAt && item.addedAt) {
      elapsed = '耗时 ' + ((item.doneAt - item.addedAt) / 1000).toFixed(1) + 's';
    } else if (item.status === 'processing' && item.addedAt) {
      elapsed = '已处理 ' + Math.floor((Date.now() - item.addedAt) / 1000) + 's';
    }
    var safeName = escapeHtml(item.mediaName || ('#' + item.mediaId));
    var safeError = item.error ? escapeHtml(item.error) : '';
    function fmtTime(ts) {
      if (!ts) return '';
      var d = new Date(ts);
      return ('0' + (d.getMonth()+1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    }
    var timeStr = '';
    if (item.addedAt) {
      timeStr = fmtTime(item.addedAt);
      if (item.doneAt && item.status === 'done') timeStr += ' - ' + fmtTime(item.doneAt);
    }
    var thumbUrl = item.resultUrl || item.mediaUrl || item.sourceUrl || '';
    var viewUrl = item.resultUrl || item.mediaUrl || '';
    return '<div class="cutout-card ' + st.cls + '">'
      + '<div class="cutout-card-main">'
      + (thumbUrl ? '<div class="cutout-card-thumb"><img src="' + thumbUrl + '" alt="" loading="lazy" onclick="window.open(\'' + (viewUrl || thumbUrl) + '\',\'_blank\')"></div>' : '<div class="cutout-card-thumb cutout-card-thumb-empty">📷</div>')
      + '<div class="cutout-card-body">'
      + '<div class="cutout-card-name">' + safeName + '</div>'
      + '<div class="cutout-card-meta">#' + item.mediaId + (item.albumId ? ' · 相册 ' + item.albumId : '') + '</div>'
      + (item.resultUrl ? '<div class="cutout-card-links"><a href="' + item.resultUrl + '" target="_blank" class="cutout-link">🔗 抠图结果</a></div>' : '')
      + (item.mediaUrl && item.mediaUrl !== item.resultUrl ? '<div class="cutout-card-links"><a href="' + item.mediaUrl + '" target="_blank" class="cutout-link">🖼️ 原图</a></div>' : '')
      + '</div>'
      + '<div class="cutout-card-right">'
      + '<span class="cutout-status-badge ' + st.cls + '">' + st.icon + ' ' + st.text + '</span>'
      + (elapsed ? '<span class="cutout-card-elapsed">' + elapsed + '</span>' : '')
      + (timeStr ? '<div class="cutout-card-time">' + timeStr + '</div>' : '')
      + '</div>'
      + '</div>'
      + (item.status === 'processing' ? '<div class="cutout-progress-bar"><div class="cutout-progress-fill"></div></div>' : '')
      + (safeError ? '<div class="cutout-card-error" title="' + safeError + '">❌ ' + safeError + '</div>' : '')
      + '</div>';
  }).join('');
}

function updateCutoutPagination() {
  var paginationEl = document.getElementById('cutout-pagination');
  var pageInfo = document.getElementById('cutout-page-info');
  var prevBtn = document.getElementById('cutout-prev-btn');
  var nextBtn = document.getElementById('cutout-next-btn');
  if (!paginationEl) return;
  var filtered = getFilteredData();
  var totalPages = Math.max(1, Math.ceil(filtered.length / CUTOUT_PAGE_SIZE));
  if (filtered.length <= CUTOUT_PAGE_SIZE) {
    paginationEl.classList.add('hidden');
    return;
  }
  paginationEl.classList.remove('hidden');
  pageInfo.textContent = '第 ' + cutoutPage + '/' + totalPages + ' 页 共 ' + filtered.length + ' 条';
  prevBtn.disabled = cutoutPage <= 1;
  nextBtn.disabled = cutoutPage >= totalPages;
}

function changeCutoutPage(delta) {
  var filtered = getFilteredData();
  var totalPages = Math.max(1, Math.ceil(filtered.length / CUTOUT_PAGE_SIZE));
  var newPage = Math.max(1, Math.min(totalPages, cutoutPage + delta));
  if (newPage === cutoutPage) return;
  cutoutPage = newPage;
  renderCutoutQueue();
  updateCutoutPagination();
}

function filterCutoutQueue(filter) {
  cutoutFilter = filter;
  cutoutPage = 1;
  document.querySelectorAll('.cutout-filter-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderCutoutQueue();
  updateCutoutPagination();
}

function clearCompletedCutout() {
  fetch('/api/cms/cutout/queue', { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        showToast('已清除已完成/失败任务');
        refreshCutoutStatus();
      }
    })
    .catch(function(err) { showToast('清除失败: ' + err.message); });
}

function switchPanel(name) {
  ['works','cutout'].forEach(function(p) {
    var el = document.getElementById('panel-' + p);
    if (el) el.classList.toggle('hidden', p !== name);
    var tab = document.getElementById('tab-' + p);
    if (tab) {
      tab.style.background = p === name ? '#c9a96e' : 'rgba(201,169,110,.15)';
      tab.style.color = p === name ? '#fff' : '#8a7a5e';
    }
  });
  document.getElementById('page-title').textContent = name === 'works' ? '🖼️ 作品展示' : '✂️ 抠图队列';
  if (name === 'cutout') {
    refreshCutoutStatus();
    checkRembgHealth();
  }
}

// ================================================
// 上传流程：仅 CMS，直接传到相册
// ================================================
function submitBatchUpload() {
  if (pendingFiles.length === 0) return;
  const names = [], dates = [];
  document.querySelectorAll('.name-input').forEach(inp => names.push(inp.value || '匿名小画家'));
  document.querySelectorAll('.date-input').forEach(inp => {
    let d = inp.value.replace(/\D/g, '');
    dates.push(d || new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  });
  const albumSelect = document.getElementById('album-select');
  const selectedAlbumId = albumSelect ? albumSelect.value : currentAlbumId;
  if (!selectedAlbumId) { showToast('请先选择目标相册'); return; }

  const progress = document.getElementById('artwork-upload-progress');
  progress.className = 'upload-progress';
  let completed = 0, errors = [];
  progress.textContent = '正在上传 0/' + pendingFiles.length;

  Promise.all(pendingFiles.map((file, i) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/cms/upload', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(async d => {
        if (d.success) {
          const r2 = await fetch('/api/cms/albums/' + selectedAlbumId + '/media/add-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaUrl: d.url, sourceUrl: d.url, mediaName: names[i] || '匿名小画家' })
          }).then(r => r.json());
          if (!r2.success) errors.push(names[i] + ': ' + (r2.error || '添加到相册失败'));
        } else errors.push(names[i] + ': ' + (d.error || '上传失败'));
        completed++;
        progress.textContent = '正在上传 ' + completed + '/' + pendingFiles.length;
      })
      .catch(err => { errors.push(names[i] + ': ' + err.message); completed++; });
  })).then(() => {
    if (errors.length) {
      progress.className = 'upload-progress error';
      progress.textContent = '完成 ' + completed + '/' + pendingFiles.length + '，' + errors.length + ' 个错误';
      showToast(errors[0]);
    } else {
      progress.className = 'upload-progress success';
      progress.textContent = '✓ 成功上传 ' + completed + ' 张作品到 CMS！';
      cancelBatchUpload();
      loadAlbumDetail(selectedAlbumId);
      loadAlbums();
    }
    setTimeout(() => progress.classList.add('hidden'), 3000);
  });
}

// ===== 相册媒体上传（从相册详情中上传）=====
(function setupAlbumMediaUpload() {
  const uploadInput = document.getElementById('album-media-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', function(e) {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      if (files.length === 0 || !currentAlbumId) { showToast('请先打开一个相册'); return; }
      e.target.value = '';
      uploadAlbumMedias(files);
    });
  }
})();

function uploadAlbumMedias(files) {
  if (!currentAlbumId) { showToast('请先打开一个相册'); return; }
  let completed = 0, errors = [];
  const progress = document.getElementById('artwork-upload-progress');
  progress.className = 'upload-progress';
  progress.textContent = '正在上传 0/' + files.length + ' 到相册...';
  progress.classList.remove('hidden');
  Promise.all(files.map((file, i) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/cms/upload', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(async d => {
        if (d.success) {
          const r2 = await fetch('/api/cms/albums/' + currentAlbumId + '/media/add-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaUrl: d.url, sourceUrl: d.url, mediaName: file.name.replace(/\.[^.]+$/, '') })
          }).then(r => r.json());
          if (!r2.success) errors.push((d.mediaName || '') + ': ' + (r2.error || '添加到相册失败'));
          // 服务器端 add-url 已自动触发抠图，无需重复处理
        } else errors.push('文件 ' + (i+1) + ': ' + (d.error || '上传失败'));
        completed++;
        progress.textContent = '正在上传 ' + completed + '/' + files.length + ' 到相册...';
      })
      .catch(err => { errors.push('文件 ' + (i+1) + ': ' + err.message); completed++; });
  })).then(() => {
    if (errors.length) {
      progress.className = 'upload-progress error';
      progress.textContent = '完成 ' + completed + '/' + files.length + '，' + errors.length + ' 个错误';
    } else {
      progress.className = 'upload-progress success';
      progress.textContent = '✓ 成功上传 ' + completed + ' 张到相册！';
      loadAlbumDetail(currentAlbumId);
      loadAlbums();
      loadWorksFromCms();
      refreshCutoutStatus();
    }
    setTimeout(() => progress.classList.add('hidden'), 3000);
  });
}
