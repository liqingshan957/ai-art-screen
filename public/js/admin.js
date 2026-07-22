/**
 * 管理后台逻辑 v2
 * - 统计看板（总数/在展/归档）
 * - Tab 切换（在展中 / 历史归档）
 * - 作品下架（归档）/ 重新上架 / 彻底删除
 * - 批量操作
 */
// ===== 全局状态 =====
let artworks = [];         // 全部作品（含归档）
let bgConfig = { filename: null, url: null, position: 'center', scale: 'cover' };
let pendingFiles = [];
let videos = [];
let activeTab = 'active';  // 'active' | 'archived'
let stats = { total: 0, active: 0, archived: 0 };

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

// 页面加载时从 API 拉取全量作品（含归档）
fetch('/api/artworks/all')
  .then(r => r.json())
  .then(list => {
    artworks = list;
    updateStats();
    renderCurrentTab();
  })
  .catch(() => {});

// 实时更新
socket.on('artwork:new', (artwork) => {
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
  document.getElementById('tab-archived-count').textContent = stats.archived;
}

// ===== Tab 切换 =====
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => {
    if ((tab === 'active' && b.textContent.includes('在展')) ||
        (tab === 'archived' && b.textContent.includes('归档'))) {
      b.classList.add('active');
    }
  });
  renderCurrentTab();
}

function renderCurrentTab() {
  if (activeTab === 'active') {
    renderActiveArtworks();
  } else {
    renderArchivedArtworks();
  }
  updateListHeaders();
}

function updateListHeaders() {
  const uploadSec = document.getElementById('upload-section');
  const listHeader = document.getElementById('list-header-title');
  const btnArchive = document.getElementById('btn-batch-archive');
  const archivedSec = document.getElementById('archived-section');
  const archivedGridEl = document.getElementById('archived-grid');

  if (activeTab === 'active') {
    uploadSec.classList.remove('hidden');
    artworkGrid.classList.remove('hidden');
    archivedGridEl.classList.add('hidden');
    archivedSec.classList.add('hidden');
    listHeader.textContent = '在展中作品';
    btnArchive.style.display = '';
  } else {
    uploadSec.classList.add('hidden');
    artworkGrid.classList.add('hidden');
    archivedGridEl.classList.remove('hidden');
    archivedSec.classList.remove('hidden');
    listHeader.textContent = '';
    btnArchive.style.display = 'none';
  }
}

// ===== 渲染在展作品 =====
function renderActiveArtworks() {
  const active = artworks.filter(a => a.status === 'active');
  if (active.length === 0) {
    artworkGrid.innerHTML = '<div class="grid-empty">所有作品都在归档中，上传新作品吧！</div>';
    return;
  }
  artworkGrid.innerHTML = active.map(a => `
    <div class="artwork-item" onclick="previewArtwork('${a.id}')">
      <img src="${a.url}" alt="${escapeAttr(a.name)}" loading="lazy">
      <div class="item-info">
        <div class="item-name">${escapeHtml(a.name)}</div>
        <div class="item-date">${escapeHtml(a.date)}</div>
      </div>
      <button class="copy-link-btn" onclick="event.stopPropagation(); copyWorkLink('${a.id}')" title="复制作品页链接">📋 作品页</button>
      <button class="btn-archive" onclick="event.stopPropagation(); archiveArtwork('${a.id}')" title="下架归档">📦 下架</button>
    </div>
  `).join('');
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
  const active = artworks.filter(a => a.status === 'active');
  if (active.length === 0) return;
  const promises = active.map(a =>
    fetch(`/api/artworks/${a.id}/archive`, { method: 'PUT' })
  );
  Promise.all(promises).then(() => {
    artworks.forEach(a => { if (a.status === 'active') { a.status = 'archived'; a.archivedAt = Date.now(); } });
    updateStats();
    renderCurrentTab();
    showToast(`已下架 ${active.length} 幅作品`);
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

function submitBatchUpload() {
  if (pendingFiles.length === 0) return;
  const names = [], dates = [];
  document.querySelectorAll('.name-input').forEach(inp => names.push(inp.value || '匿名小画家'));
  document.querySelectorAll('.date-input').forEach(inp => {
    let d = inp.value.replace(/\D/g, '');
    dates.push(d || new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  });
  const formData = new FormData();
  pendingFiles.forEach(file => formData.append('images', file));
  formData.append('names', JSON.stringify(names));
  formData.append('dates', JSON.stringify(dates));
  const progress = document.getElementById('artwork-upload-progress');
  progress.className = 'upload-progress';
  progress.textContent = `正在上传 ${pendingFiles.length} 张作品...`;
  fetch('/api/artworks/batch', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        progress.className = 'upload-progress success';
        progress.textContent = `✓ 成功上传 ${data.count} 张作品！`;
        showToast(`已上传 ${data.count} 张作品到大屏`);
        cancelBatchUpload();
        setTimeout(() => progress.classList.add('hidden'), 2500);
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

function cancelBatchUpload() {
  pendingFiles = [];
  pendingList.innerHTML = '';
  uploadForm.classList.add('hidden');
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
    bgPreview.innerHTML = '';
  } else {
    bgPreview.style.backgroundImage = '';
    bgPreview.innerHTML = '<div class="bg-placeholder">暂无背景图</div>';
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

// ===== 预览弹窗 =====
function previewArtwork(id) {
  const a = artworks.find(x => x.id === id);
  if (!a) return;
  document.getElementById('preview-img').src = a.url;
  document.getElementById('preview-name').textContent = a.name;
  document.getElementById('preview-date').textContent = (a.date || '') + (a.status === 'archived' ? ' · 已归档' : '');
  document.getElementById('preview-modal').classList.remove('hidden');
}
function closePreview(e) {
  if (!e || e.target === e.currentTarget) {
    document.getElementById('preview-modal').classList.add('hidden');
  }
}

// ===== 复制链接 =====
function copyWorkLink(id) {
  const extInput = document.getElementById('external-base-url');
  const base = extInput && extInput.value.trim() ? extInput.value.trim().replace(/\/+$/, '') : window.location.origin;
  const url = `${base}/works/${id}.html`;
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
const PAGEFIRE_URL = 'https://gzart-o8114r7d.pagefire.openhkt.com';
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
fetch('/api/artworks/all').then(r => r.json()).then(data => {
  artworks = data;
  updateStats();
  renderCurrentTab();
}).catch(() => {});

fetch('/api/artworks/stats').then(r => r.json()).then(d => {
  stats = d;
  renderStats();
}).catch(() => {});

fetch('/api/background').then(r => r.json()).then(d => {
  bgConfig = d;
  renderBackground();
}).catch(() => {});

fetch('/api/videos/config').then(r => r.json()).then(cfg => {
  document.getElementById('video-interval').value = cfg.interval || 300;
  document.getElementById('video-repeat').value = cfg.repeat || 2;
}).catch(() => {});