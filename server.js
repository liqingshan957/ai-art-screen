const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const REMBG_HOST = process.env.REMBG_HOST || 'localhost';
const REMBG_PORT = parseInt(process.env.REMBG_PORT || '7000');
const REMBG_TIMEOUT = 15000;
const CMS_POLL_INTERVAL = parseInt(process.env.CMS_POLL_INTERVAL || '5000');
const DEDUP_WINDOW = 30000;
const ENABLE_AUTO_CUTOUT = process.env.ENABLE_AUTO_CUTOUT !== 'false';

const ROOT_DIR = path.resolve(__dirname);
const WEB_DIR = path.join(ROOT_DIR, 'web-admin');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const ARTWORKS_DIR = path.join(UPLOADS_DIR, 'artworks');
const ORIGINALS_DIR = path.join(UPLOADS_DIR, 'originals');
const BG_DIR = path.join(UPLOADS_DIR, 'background');
const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const GALLERY_DIR = path.join(ROOT_DIR, 'web-gallery');
const GALLERY_WORKS_DIR = path.join(GALLERY_DIR, 'works');
const GALLERY_DATA_DIR = path.join(GALLERY_DIR, 'data');
const WORKS_DATA_FILE = path.join(GALLERY_DATA_DIR, 'works-data.json');

[UPLOADS_DIR, ARTWORKS_DIR, ORIGINALS_DIR, BG_DIR, VIDEOS_DIR, DATA_DIR, GALLERY_DATA_DIR, GALLERY_WORKS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const ARTWORKS_FILE = path.join(DATA_DIR, 'artworks.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

// ===== CMS 配置 =====
const CMS_CONFIG_FILE = path.join(DATA_DIR, 'cms-config.json');
const CMS_CACHE_FILE = path.join(DATA_DIR, 'cms-cache.json');

// 简单的 XOR + Base64 加密
const XOR_KEY = 'dunhuang2024';
function obfuscate(str) {
  if (!str) return '';
  let r = '';
  for (let i = 0; i < str.length; i++) r += String.fromCharCode(str.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
  return Buffer.from(r, 'binary').toString('base64');
}
function deobfuscate(str) {
  if (!str) return '';
  try {
    const d = Buffer.from(str, 'base64').toString('binary');
    let r = '';
    for (let i = 0; i < d.length; i++) r += String.fromCharCode(d.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
    return r;
  } catch (e) { return str; }
}

function getCmsConfig() {
  const raw = loadJSON(CMS_CONFIG_FILE, { apiKey: '', apiBase: 'https://vapi.hkting.com/api' });
  return { ...raw, apiKey: deobfuscate(raw.apiKey) };
}
function saveCmsConfig(cfg) {
  saveJSON(CMS_CONFIG_FILE, { ...cfg, apiKey: obfuscate(cfg.apiKey) });
}
function getCmsCache() { const c = loadJSON(CMS_CACHE_FILE, { albums: [], artworks: [] }); return { ...c, displayAlbumId: c.displayAlbumId || null }; }
function saveCmsCache(cache) { saveJSON(CMS_CACHE_FILE, cache); }

// 展示相册 API
app.get('/api/cms/display-album', (req, res) => {
  const cache = getCmsCache();
  res.json({ albumId: cache.displayAlbumId || null });
});
app.put('/api/cms/display-album', express.json(), (req, res) => {
  const cache = getCmsCache();
  cache.displayAlbumId = req.body.albumId || null;
  saveCmsCache(cache);
  // 通知大屏刷新数据（相册切换）
  io.emit('display:reload', { albumId: cache.displayAlbumId });
  res.json({ success: true, albumId: cache.displayAlbumId });
});

function loadJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('Read data failed:', file, e.message); }
  return fallback;
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
/** 保存 settings.json 的某个分区（background / videoConfig / dashboard） */
function saveSettingsJSON(section, data) {
  const s = loadJSON(SETTINGS_FILE, {});
  s[section] = data;
  saveJSON(SETTINGS_FILE, s);
}

let artworks = loadJSON(ARTWORKS_FILE, []);
let videos = loadJSON(VIDEOS_FILE, []);
let analytics = loadJSON(ANALYTICS_FILE, {});
artworks = artworks.map(a => ({ ...a, status: a.status || 'active' }));

// 从 settings.json 统一加载背景、视频配置、看板数据
// 兼容旧版：若 settings.json 不存在但旧文件存在，则迁移
const OLD_BG_FILE = path.join(DATA_DIR, 'background.json');
const OLD_VC_FILE = path.join(DATA_DIR, 'videos_config.json');
const OLD_DB_FILE = path.join(DATA_DIR, 'dashboard.json');
if (!fs.existsSync(SETTINGS_FILE)) {
  const _s = {};
  if (fs.existsSync(OLD_BG_FILE)) _s.background = loadJSON(OLD_BG_FILE, {});
  if (fs.existsSync(OLD_VC_FILE)) _s.videoConfig = loadJSON(OLD_VC_FILE, {});
  if (fs.existsSync(OLD_DB_FILE)) _s.dashboard = loadJSON(OLD_DB_FILE, {});
  if (Object.keys(_s).length) saveJSON(SETTINGS_FILE, _s);
}
const _settings = loadJSON(SETTINGS_FILE, {});
let bgConfig = { filename: null, position: 'center', scale: 'cover', url: null, cmsUrl: null, ...(_settings.background || {}) };
let videoConfig = { interval: 300, repeat: 2, ...(_settings.videoConfig || {}) };
let dashboardData = _settings.dashboard || {};

// ===== 合并 CMS 缓存中的作品，按展示相册过滤 =====
function getAllArtworks(filterEnabled = true) {
  const cache = getCmsCache();
  const displayAlbumId = cache.displayAlbumId || null;
  const cmsWorks = [];
  if (cache.albums) {
    cache.albums.forEach(album => {
      // 相册本身被禁用 → 跳过
      if (filterEnabled && album.enabled === false) return;
      // 展示模式 → 只取展示相册
      if (filterEnabled && displayAlbumId && String(album.albumId) !== String(displayAlbumId)) return;
      if (album.medias) {
        album.medias.forEach(m => {
          if (filterEnabled && m.enabled === false) return;
          // enabled=false 且 filterEnabled=false（管理后台）→ 设为 archived 状态
          // enabled=false 且 filterEnabled=true（画廊/大屏）→ 已在上面 return 排除
          const cmsStatus = (m.enabled === false) ? 'archived' : 'active';
          cmsWorks.push({
            id: 'cms_' + (m.mediaId || Math.random().toString(36).slice(2, 10)),
            name: m.localName || m.mediaName || '匿名小画家',
            date: m.createTime ? m.createTime.slice(0, 10).replace(/-/g, '') : '',
            url: m.cutoutUrl || m.mediaUrl,
            mediaUrl: m.mediaUrl,
            originalUrl: m.sourceUrl || m.mediaUrl,
            thumbnailUrl: m.thumbnailUrl || m.mediaUrl,
            status: cmsStatus,
            isCms: true,
            albumId: album.albumId,
            albumName: album.albumName || '',
            mediaId: m.mediaId,
            createdAt: m.createTime ? new Date(m.createTime).getTime() : 0,
            sourceUrl: m.sourceUrl,
            cutoutUrl: m.cutoutUrl
          });
        });
      }
    });
  }
  // 合并并且去重（CMS 优先）
  const seen = new Set();
  return [...cmsWorks, ...artworks].filter(a => {
    const key = a.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateWorksDataJson() {
  const list = getAllArtworks(true).map(a => ({
    id: a.id, name: a.name, date: a.date, url: a.mediaUrl || a.url, albumId: a.albumId, albumName: a.albumName
  }));
  saveJSON(WORKS_DATA_FILE, list);
}

// ===== Analytics =====
function todayKey() { const d=new Date(); return ''+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); }
function ensureToday() {
  const k=todayKey();
  if(!analytics[k]) analytics[k]={pageViews:0,visitors:[],newArtworks:0,displayViews:0,shareClicks:0};
  return analytics[k];
}
function track(field, extra) {
  const t=ensureToday();
  if(field==='pageViews'){t.pageViews++;if(extra&&!t.visitors.includes(extra))t.visitors.push(extra);}
  else if(field==='newArtworks') t.newArtworks+=(typeof extra==='number'?extra:1);
  else t[field]=(t[field]||0)+1;
  saveJSON(ANALYTICS_FILE, analytics);
}
function getClientIP(req) {
  const f=req.headers['x-forwarded-for'];
  return f?f.split(',')[0].trim():req.socket.remoteAddress||'unknown';
}

// ===== Multer =====
const artworkStorage=multer.diskStorage({destination:(r,f,cb)=>cb(null,ARTWORKS_DIR),filename:(r,f,cb)=>{const id=crypto.randomBytes(8).toString('hex');cb(null,id+path.extname(f.originalname).toLowerCase());}});
const bgStorage=multer.diskStorage({destination:(r,f,cb)=>cb(null,BG_DIR),filename:(r,f,cb)=>cb(null,'background'+path.extname(f.originalname).toLowerCase())});
const videoStorage=multer.diskStorage({destination:(r,f,cb)=>cb(null,VIDEOS_DIR),filename:(r,f,cb)=>{const id=crypto.randomBytes(8).toString('hex');cb(null,id+path.extname(f.originalname).toLowerCase());}});
const imageFilter=(r,f,cb)=>{const a=['.jpg','.jpeg','.png','.webp','.gif','.bmp'];const e=path.extname(f.originalname).toLowerCase();cb(a.includes(e)?null:new Error('Images only'),a.includes(e));};
const videoFilter=(r,f,cb)=>{const a=['.mp4','.webm','.avi','.mov','.mkv'];const e=path.extname(f.originalname).toLowerCase();cb(a.includes(e)?null:new Error('Videos only'),a.includes(e));};
const uploadArtwork=multer({storage:artworkStorage,fileFilter:imageFilter,limits:{fileSize:20*1024*1024}});
const uploadBg=multer({storage:bgStorage,fileFilter:imageFilter,limits:{fileSize:30*1024*1024}});
const uploadVideo=multer({storage:videoStorage,fileFilter:videoFilter,limits:{fileSize:500*1024*1024}});

// ===== Rembg =====
async function callRembg(imagePath) {
  const d=fs.readFileSync(imagePath),fn=path.basename(imagePath),b='----Rembg'+crypto.randomBytes(8).toString('hex');
  const hdr=Buffer.from('--'+b+'\r\nContent-Disposition: form-data; name="file"; filename="'+fn+'"\r\nContent-Type: application/octet-stream\r\n\r\n');
  const ftr=Buffer.from('\r\n--'+b+'--\r\n'),body=Buffer.concat([hdr,d,ftr]);
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:REMBG_HOST,port:REMBG_PORT,path:'/api/remove',method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+b,'Content-Length':body.length}},(res)=>{
      if(res.statusCode!==200){reject(new Error('Rembg HTTP '+res.statusCode));return;}
      const c=[];res.on('data',x=>c.push(x));res.on('end',()=>resolve(Buffer.concat(c)));
    });
    req.on('error',reject);req.setTimeout(REMBG_TIMEOUT,()=>{req.destroy();reject(new Error('Rembg timeout'));});
    req.write(body);req.end();
  });
}

function calcCrop(m){return{left:Math.round(m.width*8/102),top:Math.round(m.height*8/152),width:Math.round(m.width*(102-8-8)/102),height:Math.round(m.height*(152-8-32)/152)};}

// ===== CMS API 代理 =====
async function cmsRequest(path, options = {}) {
  const cfg = getCmsConfig();
  if (!cfg.apiKey) throw new Error('CMS 未配置，请先设置 API Key');
  const url = cfg.apiBase.replace(/\/+$/, '') + '/open-api/v1' + path;
  const headers = { 'X-Api-Key': cfg.apiKey, ...options.headers };
  const resp = await fetch(url, { ...options, headers });
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await resp.json();
    if (data.code !== 0) throw new Error(data.message || 'CMS API 错误 (code=' + data.code + ')');
    return data.data;
  }
  // 非 JSON 响应（如 HTML 错误页）
  const text = await resp.text();
  throw new Error('CMS 返回非 JSON (' + resp.status + '): ' + text.slice(0, 200));
}

/** JSON 对象转 x-www-form-urlencoded 字符串 */
function toFormBody(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null) p.set(k, String(v)); });
  return p.toString();
}

// CMS 配置 API
app.get('/api/cms/config', (req, res) => {
  const cfg = getCmsConfig();
  const masked = cfg.apiKey ? cfg.apiKey.slice(0, 7) + '****' + cfg.apiKey.slice(-4) : '';
  res.json({ configured: !!cfg.apiKey, apiKeyPrefix: masked, apiBase: cfg.apiBase });
});
app.post('/api/cms/config', express.json(), (req, res) => {
  const cfg = getCmsConfig();
  if (req.body.apiKey !== undefined) cfg.apiKey = req.body.apiKey;
  if (req.body.apiBase !== undefined) cfg.apiBase = req.body.apiBase;
  saveCmsConfig(cfg);
  res.json({ success: true });
});
app.get('/api/cms/test', async (req, res) => {
  try {
    const data = await cmsRequest('/tenant/profile');
    res.json({ success: true, tenant: data });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ===== CMS 活动相册代理 =====
// 辅助：合并本地增强字段
function mergeLocalAlbum(album) {
  const cache = getCmsCache();
  const local = cache.albums.find(a => String(a.albumId) === String(album.albumId || album.id));
  return { ...album, enabled: local ? local.enabled !== false : true, displayOrder: local?.displayOrder || 0 };
}

// 列表
app.get('/api/cms/albums', async (req, res) => {
  try {
    const { pageNum = 1, pageSize = 50 } = req.query;
    const data = await cmsRequest(`/activity-albums?pageNum=${pageNum}&pageSize=${pageSize}`);
    const rows = (data.rows || []).map(mergeLocalAlbum);
    res.json({ success: true, data: { total: data.total || rows.length, rows }, fromCache: false });
  } catch (e) {
    // Fallback to cache
    const cache = getCmsCache();
    res.json({ success: true, data: { total: cache.albums.length, rows: cache.albums }, fromCache: true });
  }
});

// 创建
app.post('/api/cms/albums', express.json(), async (req, res) => {
  try {
    const data = await cmsRequest('/activity-albums', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumName: req.body.albumName, albumStatus: req.body.albumStatus || '1', location: req.body.location || '' })
    });
    res.json({ success: true, album: { ...data, enabled: true, displayOrder: 0 } });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 详情
app.get('/api/cms/albums/:id', async (req, res) => {
  try {
    const data = await cmsRequest(`/activity-albums/${req.params.id}`);
    const merged = mergeLocalAlbum(data);
    res.json({ success: true, album: merged, fromCache: false });
  } catch (e) {
    const cache = getCmsCache();
    const album = cache.albums.find(a => String(a.albumId) === req.params.id);
    res.json({ success: !!album, album: album || null, fromCache: true });
  }
});

// 更新
app.put('/api/cms/albums/:id', express.json(), async (req, res) => {
  try {
    const data = await cmsRequest(`/activity-albums/${req.params.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    res.json({ success: true, album: data });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 媒体列表
app.get('/api/cms/albums/:id/media', async (req, res) => {
  try {
    const { pageNum = 1, pageSize = 200 } = req.query;
    const data = await cmsRequest(`/activity-albums/${req.params.id}/media?pageNum=${pageNum}&pageSize=${pageSize}`);
    const rows = (data.rows || data || []).map(m => {
      const cache = getCmsCache();
      const local = cache.albums.flatMap(a => a.medias || []).find(mm => String(mm.mediaId) === String(m.mediaId || m.id));
      return { ...m, enabled: local ? local.enabled !== false : true, localName: local?.localName || '' };
    });
    res.json({ success: true, data: { total: data.total || rows.length, rows }, fromCache: false });
  } catch (e) {
    const cache = getCmsCache();
    const album = cache.albums.find(a => String(a.albumId) === req.params.id);
    const rows = (album?.medias || []).map(m => ({ ...m, enabled: m.enabled !== false }));
    res.json({ success: true, data: { total: rows.length, rows }, fromCache: true });
  }
});

// 添加媒体（支持文件上传 + 裁剪）
const cmsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.post('/api/cms/albums/:id/media', cmsUpload.single('file'), async (req, res) => {
  try {
    const albumId = req.params.id;
    // 步骤1: 上传文件到 CMS
    if (!req.file) return res.json({ success: false, error: '请选择文件' });
    const uploadResult = await cmsFileUpload(req.file, 'original');
    // 步骤2: 添加媒体到相册
    const body = {
      mediaUrl: uploadResult.url,
      mediaType: req.body.mediaType || 'image',
      mediaName: req.body.mediaName || req.file.originalname.replace(/\.[^.]+$/, ''),
      sourceUrl: uploadResult.url
    };
    if (req.body.mediaName) body.mediaName = req.body.mediaName;
    if (req.body.cropX !== undefined) { body.cropX = parseInt(req.body.cropX); body.cropY = parseInt(req.body.cropY); body.cropWidth = parseInt(req.body.cropWidth); body.cropHeight = parseInt(req.body.cropHeight); }
    if (req.body.naturalWidth !== undefined) { body.naturalWidth = parseInt(req.body.naturalWidth); body.naturalHeight = parseInt(req.body.naturalHeight); }
    const data = await cmsRequest(`/activity-albums/${albumId}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    // 步骤3: 缓存本地
    const cache = getCmsCache();
    let album = cache.albums.find(a => String(a.albumId) === albumId);
    if (!album) { album = { albumId, medias: [] }; cache.albums.push(album); }
    if (!album.medias) album.medias = [];
    album.medias.push({ mediaId: data.mediaId || data.id, mediaUrl: uploadResult.url, sourceUrl: uploadResult.url, mediaName: body.mediaName, enabled: true, mediaType: 'image' });
    saveCmsCache(cache);
    // 步骤4: 向大屏推送新作品通知
    const workId = 'cms_' + (data.mediaId || data.id);
    const newWork = { id: workId, name: body.mediaName, date: new Date().toISOString().slice(0,10).replace(/-/g,''), url: uploadResult.url, originalUrl: uploadResult.url, status: 'active', isCms: true };
    io.emit('artwork:new', newWork);
    res.json({ success: true, media: { ...data, mediaUrl: uploadResult.url, enabled: true, id: workId } });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 添加媒体（仅 JSON，URL 已存在，不需要重新上传文件）
app.post('/api/cms/albums/:id/media/add-url', express.json(), async (req, res) => {
  try {
    const albumId = req.params.id;
    const body = {
      mediaUrl: req.body.mediaUrl,
      mediaType: req.body.mediaType || 'image',
      mediaName: req.body.mediaName || '',
      sourceUrl: req.body.sourceUrl || req.body.mediaUrl
    };
    if (!body.mediaUrl) return res.json({ success: false, error: 'mediaUrl 必填' });
    if (req.body.cropX !== undefined) { body.cropX = parseInt(req.body.cropX); body.cropY = parseInt(req.body.cropY); body.cropWidth = parseInt(req.body.cropWidth); body.cropHeight = parseInt(req.body.cropHeight); }
    if (req.body.naturalWidth !== undefined) { body.naturalWidth = parseInt(req.body.naturalWidth); body.naturalHeight = parseInt(req.body.naturalHeight); }
    const data = await cmsRequest(`/activity-albums/${albumId}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    // 缓存本地
    const cache = getCmsCache();
    let album = cache.albums.find(a => String(a.albumId) === albumId);
    if (!album) { album = { albumId, medias: [] }; cache.albums.push(album); }
    if (!album.medias) album.medias = [];
    const mediaEntry = { mediaId: data.mediaId || data.id, mediaUrl: body.mediaUrl, sourceUrl: body.sourceUrl, mediaName: body.mediaName, enabled: true, mediaType: 'image' };
    album.medias.push(mediaEntry);
    saveCmsCache(cache);
    // 自动触发抠图（ENABLE_AUTO_CUTOUT=false 时由本地 Rembg 工作脚本 + notify 处理）
    if (ENABLE_AUTO_CUTOUT) {
      const workId = 'cms_' + mediaEntry.mediaId;
      if (!cutoutQueue.find(q => String(q.mediaId) === String(mediaEntry.mediaId))) {
        cutoutQueue.push({ albumId, mediaId: String(mediaEntry.mediaId), mediaUrl: body.mediaUrl, sourceUrl: body.sourceUrl, mediaName: body.mediaName || '', status: 'pending', addedAt: Date.now() });
        persistCutoutQueue();
        if (!isProcessingCutout) processCutoutQueue();
      }
    }
    res.json({ success: true, media: { ...data, mediaUrl: body.mediaUrl, enabled: true, id: 'cms_' + mediaEntry.mediaId } });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 更新媒体
app.put('/api/cms/albums/:id/media/:mediaId', express.json(), async (req, res) => {
  try {
    const data = await cmsRequest(`/activity-albums/${req.params.id}/media/${req.params.mediaId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    // 更新缓存
    const cache = getCmsCache();
    const album = cache.albums.find(a => String(a.albumId) === req.params.id);
    if (album && album.medias) {
      const idx = album.medias.findIndex(m => String(m.mediaId) === req.params.mediaId);
      if (idx !== -1) Object.assign(album.medias[idx], req.body);
      saveCmsCache(cache);
    }
    res.json({ success: true, media: data });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 删除媒体
app.delete('/api/cms/albums/:id/media/:mediaId', async (req, res) => {
  try {
    await cmsRequest(`/activity-albums/${req.params.id}/media/${req.params.mediaId}`, { method: 'DELETE' });
    const cache = getCmsCache();
    const album = cache.albums.find(a => String(a.albumId) === req.params.id);
    if (album && album.medias) { album.medias = album.medias.filter(m => String(m.mediaId) !== req.params.mediaId); saveCmsCache(cache); }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 浏览+1 / 点赞+1
app.post('/api/cms/albums/media/:mediaId/view', async (req, res) => {
  try { await cmsRequest(`/activity-albums/media/${req.params.mediaId}/view`, { method: 'POST' }); res.json({ success: true }); } catch (e) { res.json({ success: false }); }
});
app.post('/api/cms/albums/media/:mediaId/like', async (req, res) => {
  try { await cmsRequest(`/activity-albums/media/${req.params.mediaId}/like`, { method: 'POST' }); res.json({ success: true }); } catch (e) { res.json({ success: false }); }
});

// 检查相册新增媒体（游标轮询）
app.get('/api/cms/albums/:id/media/check', async (req, res) => {
  try {
    const sinceId = req.query.sinceId || 0;
    const limit = req.query.limit || 50;
    const data = await cmsRequest('/activity-albums/' + req.params.id + '/media/check?sinceId=' + sinceId + '&limit=' + limit);
    res.json({ success: true, data: data });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 上传文件到 CMS（便捷代理）
/** 截断文件名（CMS 限制 100 字节，中文占3字节） */
function truncateFilename(name) {
  if (Buffer.byteLength(name, "utf8") <= 90) return name;
  const ext = require("path").extname(name);
  const base = Buffer.from(name.slice(0, 30), "utf8");
  return base.slice(0, 80).toString("utf8").replace(/[ -]/g, "") + ext;
}
async function cmsFileUpload(file, mode) {
  const BOUNDARY = '----CMS' + crypto.randomBytes(8).toString('hex');
  let body = Buffer.from('');
  const append = (s) => { body = Buffer.concat([body, Buffer.from(s)]); };
  append(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${truncateFilename(file.originalname)}"\r\nContent-Type: ${file.mimetype || 'application/octet-stream'}\r\n\r\n`);
  body = Buffer.concat([body, file.buffer]);
  if (mode) append(`\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="mode"\r\n\r\n${mode}`);
  append(`\r\n--${BOUNDARY}--\r\n`);
  const cfg = getCmsConfig();
  const url = cfg.apiBase.replace(/\/+$/, '') + '/open-api/v1/files/upload';
  const resp = await fetch(url, {
    method: 'POST', headers: { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'multipart/form-data; boundary=' + BOUNDARY, 'Content-Length': body.length },
    body
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error('文件上传失败: ' + data.message);
  return data.data;
}
app.post('/api/cms/upload', cmsUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, error: '请选择文件' });
    const data = await cmsFileUpload(req.file, 'original');
    res.json({ success: true, url: data.url, width: data.width, height: data.height });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ===== 本地增强（启用/禁用/排序） =====
app.put('/api/cms/albums/:id/enable', express.json(), (req, res) => {
  const cache = getCmsCache();
  let album = cache.albums.find(a => String(a.albumId) === req.params.id);
  if (!album) { album = { albumId: req.params.id, medias: [] }; cache.albums.push(album); }
  album.enabled = req.body.enabled !== false;
  saveCmsCache(cache);
  res.json({ success: true, enabled: album.enabled });
});
app.put('/api/cms/albums/:id/media/:mediaId/enable', express.json(), (req, res) => {
  const cache = getCmsCache();
  const album = cache.albums.find(a => String(a.albumId) === req.params.id);
  if (album && album.medias) {
    const m = album.medias.find(mm => String(mm.mediaId) === req.params.mediaId);
    if (m) {
      m.enabled = req.body.enabled !== false;
      saveCmsCache(cache);
      const workId = 'cms_' + m.mediaId;
      const evt = m.enabled ? 'artwork:restore' : 'artwork:archive';
      io.emit(evt, m.enabled ? { id: workId, artwork: { id: workId, name: m.mediaName || '', url: m.mediaUrl, status: 'active', isCms: true } } : { id: workId });
      res.json({ success: true, enabled: m.enabled });
    } else res.json({ success: false, error: 'Media not found' });
  } else res.json({ success: false, error: 'Album not found' });
});

// ===== Rembg 健康检测 =====
app.get('/api/cms/rembg-health', async (req, res) => {
  try {
    const resp = await fetch(`http://${REMBG_HOST}:${REMBG_PORT}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) { const d = await resp.json(); return res.json({ success: true, status: d.status || 'ready' }); }
    res.json({ success: false, status: 'error' });
  } catch (e) { res.json({ success: false, status: 'unavailable', error: e.message }); }
});

// ===== 异步抠图流水线 =====
const CUTOUT_DIR = path.join(UPLOADS_DIR, 'cutout_temp');
if (!fs.existsSync(CUTOUT_DIR)) fs.mkdirSync(CUTOUT_DIR, { recursive: true });

let isProcessingCutout = false;
let cutoutQueue = loadJSON(DATA_DIR + '/cutout-queue.json', []);
function persistCutoutQueue() { saveJSON(DATA_DIR + '/cutout-queue.json', cutoutQueue); }

/** 处理单个抠图任务 */
async function processOneCutout(item) {
  console.log('[Cutout] 处理:', item.mediaName || item.mediaId);
  let mediaInfo;
  try { mediaInfo = await cmsRequest('/activity-albums/media/' + item.mediaId); } catch (e) {}
  if (mediaInfo) {
    if (mediaInfo.cutoutUrl) { item.status = 'done'; item.resultUrl = mediaInfo.cutoutUrl; item.doneAt = Date.now(); console.log('[Cutout] 跳过(已有抠图):', item.mediaName || item.mediaId); return; }
    item.mediaUrl = mediaInfo.mediaUrl || item.mediaUrl;
    item.sourceUrl = mediaInfo.sourceUrl || item.sourceUrl;
  }
  const downloadUrl = item.mediaUrl || item.sourceUrl;
  if (!downloadUrl) throw new Error('没有可下载的图片 URL');
  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error('下载失败 HTTP ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ext = path.extname(new URL(downloadUrl).pathname) || '.jpg';
  const tmpFile = path.join(CUTOUT_DIR, item.mediaId + ext);
  fs.writeFileSync(tmpFile, buf);
  let mattedBuffer;
  try { mattedBuffer = await callRembg(tmpFile); } catch (e) {
    console.warn('[Cutout] Rembg 不可用，跳过', item.mediaName || item.mediaId, ':', e.message);
    try { fs.unlinkSync(tmpFile); } catch (e2) {}
    throw new Error('Rembg 不可用，跳过'); // 跳到 catch 标记 error，下次重试
  }
  const cutoutFile = { originalname: 'cutout_' + item.mediaId + '.png', buffer: mattedBuffer, mimetype: 'image/png', size: mattedBuffer.length };
  const uploadResult = await cmsFileUpload(cutoutFile);
  await cmsRequest(`/activity-albums/${item.albumId}/media/${item.mediaId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cutoutUrl: uploadResult.url })
  });
  const cCache = getCmsCache();
  const cAlbum = cCache.albums.find(a => String(a.albumId) === item.albumId);
  if (cAlbum && cAlbum.medias) {
    const cMedia = cAlbum.medias.find(m => String(m.mediaId) === item.mediaId);
    if (cMedia) cMedia.cutoutUrl = uploadResult.url;
  }
  saveCmsCache(cCache);
  const workId = 'cms_' + item.mediaId;
  io.emit('artwork:new', { id: workId, name: item.mediaName || '', date: new Date().toISOString().slice(0,10).replace(/-/g,''), url: uploadResult.url, originalUrl: item.mediaUrl, status: 'active', isCms: true });
  item.status = 'done'; item.resultUrl = uploadResult.url; item.doneAt = Date.now();
  console.log('[Cutout] 完成:', item.mediaName || item.mediaId, '→', uploadResult.url);
}
/** 后台处理抠图队列（并发 3 张） */
async function processCutoutQueue() {
  if (isProcessingCutout) return;
  isProcessingCutout = true;
  while (true) {
    const batch = cutoutQueue.filter(q => q.status === 'pending').slice(0, 3);
    if (batch.length === 0) break;
    batch.forEach(item => { item.status = 'processing'; });
    persistCutoutQueue();
    await Promise.allSettled(batch.map(item =>
      processOneCutout(item).catch(e => {
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount >= 5) {
          item.status = 'error'; item.error = e.message; item.doneAt = Date.now();
          console.error('[Cutout] 已达最大重试次数:', item.mediaName || item.mediaId, '(' + item.retryCount + '次)', e.message);
        } else {
          item.status = 'pending'; item.error = e.message;
          console.warn('[Cutout] 失败，稍后重试:', item.mediaName || item.mediaId, '(' + item.retryCount + '/5)', e.message);
        }
      })
    ));
    persistCutoutQueue();
  }
  generateWorksDataJson();
  isProcessingCutout = false;
}
(function resumeCutoutQueue() {
  cutoutQueue.forEach(q => { if (q.status === 'processing') q.status = 'pending'; });
  persistCutoutQueue();
  if (cutoutQueue.find(q => q.status === 'pending')) setTimeout(processCutoutQueue, 2000);
})();

// 批量扫描：将缺少抠图的媒体加入队列
// ⚠️ 必须放在 /:albumId/:mediaId 之前，避免 "scan" 被当作 albumId 匹配
app.post('/api/cms/cutout/scan/:albumId', async (req, res) => {
  try {
    const data = await cmsRequest(`/activity-albums/${req.params.albumId}/media?pageSize=200`);
    const rows = data.rows || data || [];
    const needsProcessing = rows.filter(m => !m.cutoutUrl);
    let added = 0;
    needsProcessing.forEach(m => {
      if (!cutoutQueue.find(q => String(q.mediaId) === String(m.mediaId || m.id))) {
        cutoutQueue.push({ albumId: req.params.albumId, mediaId: String(m.mediaId || m.id), mediaUrl: m.mediaUrl || m.sourceUrl, sourceUrl: m.sourceUrl, mediaName: m.mediaName || '', status: 'pending', addedAt: Date.now() });
        added++;
      }
    });
    persistCutoutQueue();
    if (added > 0 && ENABLE_AUTO_CUTOUT) processCutoutQueue();
    res.json({ success: true, addedToQueue: added, totalMissing: needsProcessing.length });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 手动触发单张抠图
app.post('/api/cms/cutout/:albumId/:mediaId', async (req, res) => {
  try {
    const { albumId, mediaId } = req.params;
    const data = await cmsRequest(`/activity-albums/media/${mediaId}`);
    if (!data.sourceUrl && !data.mediaUrl) return res.json({ success: false, error: '没有可处理的图片 URL' });
    if (!cutoutQueue.find(q => String(q.mediaId) === mediaId)) {
      cutoutQueue.push({ albumId, mediaId, mediaUrl: data.mediaUrl || data.sourceUrl, sourceUrl: data.sourceUrl, mediaName: data.mediaName || '', status: 'pending', addedAt: Date.now() });
      persistCutoutQueue();
      if (ENABLE_AUTO_CUTOUT) processCutoutQueue();
    }
    res.json({ success: true, message: '已加入抠图队列' });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 查询队列状态
app.get('/api/cms/cutout/queue', (req, res) => {
  res.json({ items: cutoutQueue, processing: isProcessingCutout });
});

// 清空已完成队列
app.delete('/api/cms/cutout/queue', (req, res) => {
  cutoutQueue = cutoutQueue.filter(q => q.status !== 'done' && q.status !== 'error');
  persistCutoutQueue();
  res.json({ success: true, remaining: cutoutQueue.length });
});

// ===== 同步 CMS 数据到本地缓存 =====
app.post('/api/cms/sync', async (req, res) => {
  try {
    const data = await cmsRequest('/activity-albums?pageSize=200');
    const rows = data.rows || data || [];
    const cache = getCmsCache();
    // 保留本地增强字段，合并 CMS 最新数据
    for (const album of rows) {
      const albumId = String(album.albumId || album.id);
      const existing = cache.albums.find(a => String(a.albumId) === albumId);
      const localFields = existing ? { enabled: existing.enabled, displayOrder: existing.displayOrder, medias: existing.medias || [] } : { enabled: true, displayOrder: 0, medias: [] };
      const idx = cache.albums.findIndex(a => String(a.albumId) === albumId);
      const merged = { ...album, albumId, ...localFields };
      if (idx !== -1) cache.albums[idx] = merged; else cache.albums.push(merged);
      // 同步每个相册的 media 列表（最多 200 条）
      try {
        const mediaData = await cmsRequest(`/activity-albums/${albumId}/media?pageSize=200`);
        const mediaRows = mediaData.rows || mediaData || [];
        const mergedMedias = mediaRows.map(m => {
          const mediaId = String(m.mediaId || m.id);
          const localMedia = (localFields.medias || []).find(mm => String(mm.mediaId) === mediaId);
          return { ...m, mediaId, enabled: localMedia ? localMedia.enabled !== false : true, localName: localMedia?.localName || '' };
        });
        const albumCache = cache.albums.find(a => String(a.albumId) === albumId);
        if (albumCache) albumCache.medias = mergedMedias;
      } catch (e) { /* 单个相册 media 同步失败不影响整体 */ }
    }
    saveCmsCache(cache);
    res.json({ success: true, albumsCount: cache.albums.length });
  } catch (e) { res.json({ success: false, error: e.message }); }
});
app.use(express.static(WEB_DIR, { index: false, redirect: false }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/display',(req,res)=>res.sendFile(path.join(WEB_DIR,'display.html')));
app.get('/admin',(req,res)=>res.sendFile(path.join(WEB_DIR,'admin.html')));
app.get('/admin/settings', (req,res)=>res.sendFile(path.join(WEB_DIR,'admin.html')));
app.get('/dashboard',(req,res)=>res.sendFile(path.join(WEB_DIR,'dashboard.html')));
app.get('/',(req,res)=>res.redirect('/admin'));

// 画廊 SPA（同时支持独立部署到 PageFire）
// 先拦截 /gallery 和 /gallery/ 做 API Key 注入，再 fallback 静态文件
app.get('/gallery', (req, res) => serveGallery(res));
app.get('/gallery/', (req, res) => serveGallery(res));
app.use('/gallery', express.static(path.join(ROOT_DIR, 'web-gallery'), { redirect: false, index: false }));
app.get('/gallery/*', (req, res) => {
  // SPA fallback：未知路径返回 index.html
  serveGallery(res);
});

function serveGallery(res) {
  const cfg = getCmsConfig();
  if (cfg.apiKey) {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'web-gallery', 'index.html'), 'utf8');
    res.send(html.replace(/<meta name="cms-api-key"[^>]+>/, '<meta name="cms-api-key" content="' + cfg.apiKey + '">'));
  } else {
    res.sendFile(path.join(ROOT_DIR, 'web-gallery', 'index.html'));
  }
}
// 手机作品分享页 SSR（work.html?work=xxx → 服务端渲染 OG 标签）
// 获取请求的站点域名（含 protocol），用于将相对路径转为绝对 URL
function getSiteOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'art.hkting.com';
  return proto + '://' + host;
}
function toAbsoluteUrl(url, origin) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return origin + (url.startsWith('/') ? url : '/' + url);
}
const DEFAULT_OG_IMAGE = 'https://img.hkting.com/api/profile/upload/2026/07/29/b2f0dda6b85340f493a91a98175dc7df-c.jpg';
const OG_IMAGE_MAX_BYTES = 300 * 1024; // 微信要求 < 300KB
const OG_SIZE_CACHE_TTL = 60 * 60 * 1000; // 缓存 1 小时，同一图片不重复 HEAD 检查
const OG_SIZE_CACHE_MAX = 500;            // 最多缓存 500 条，防止无限增长
const ogSizeCache = new Map(); // url -> { ok: bool, ts: number }

// HEAD 请求检查图片文件大小，结果缓存 1 小时，超限返回 false
async function isOgImageSizeOk(url) {
  if (!url) return false;
  const cached = ogSizeCache.get(url);
  if (cached && Date.now() - cached.ts < OG_SIZE_CACHE_TTL) return cached.ok;
  try {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const ok = await new Promise((resolve) => {
      const req = mod.request(
        { hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search, method: 'HEAD' },
        (res) => {
          const len = parseInt(res.headers['content-length'] || '0', 10);
          // content-length 缺失（值为 0）时保守放行，让微信自己判断
          resolve(len === 0 || len <= OG_IMAGE_MAX_BYTES);
        }
      );
      req.setTimeout(3000, () => { req.destroy(); resolve(true); }); // 超时保守放行
      req.on('error', () => resolve(true)); // 网络错误保守放行
      req.end();
    });
    // 超出上限时删除最早的一条（Map 按插入顺序迭代）
    if (ogSizeCache.size >= OG_SIZE_CACHE_MAX) ogSizeCache.delete(ogSizeCache.keys().next().value);
    ogSizeCache.set(url, { ok, ts: Date.now() });
    return ok;
  } catch (e) {
    return true; // URL 解析失败保守放行
  }
}

// work.html 模板缓存（避免每次请求都读磁盘）
let workHtmlTemplate = null;
function getWorkHtmlTemplate() {
  if (!workHtmlTemplate) workHtmlTemplate = fs.readFileSync(path.join(ROOT_DIR, 'web-gallery', 'work.html'), 'utf8');
  return workHtmlTemplate;
}

function buildWorkHtml(workId, name, imgUrl, date, origin) {
  const templateHtml = getWorkHtmlTemplate();
  const title = (name || '小画家') + ' · 敦煌AIGC艺术作品';
  const desc = '大象智绘 AI 科创 · 孩子们用 AI 创作的敦煌风格艺术作品';
  const usingDefault = !imgUrl;
  const absImg = usingDefault ? DEFAULT_OG_IMAGE : toAbsoluteUrl(imgUrl, origin);
  const pageUrl = origin + '/work.html?work=' + encodeURIComponent(workId);
  const imgAlt = (name || '小画家') + '的 AI 艺术作品 · 敦煌 AIGC 艺术展';
  const q = s => String(s).replace(/"/g, '&quot;');
  // 替换模板中已有的默认占位标签，避免产生重复 meta
  let html = templateHtml
    .replace('<title>AI 艺术作品 · 敦煌 AIGC 艺术展</title>', '<title>' + q(title) + '</title>')
    .replace(/(<meta property="og:title" content=")[^"]*(")/g, '$1' + q(title) + '$2')
    .replace(/(<meta property="og:image" content=")[^"]*(")/g, '$1' + q(absImg) + '$2')
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/g, '$1' + q(absImg) + '$2')
    .replace(/(<meta property="og:image:alt" content=")[^"]*(")/g, '$1' + q(imgAlt) + '$2')
    .replace(/(<meta name="twitter:image:alt" content=")[^"]*(")/g, '$1' + q(imgAlt) + '$2')
    .replace(/(<meta property="og:description" content=")[^"]*(")/g, '$1' + q(desc) + '$2')
    .replace(/<meta property="og:type"[^>]*>/, m =>
      m +
      '\n  <meta property="og:url" content="' + q(pageUrl) + '">' +
      '\n  <meta name="twitter:title" content="' + q(title) + '">' +
      '\n  <meta name="twitter:description" content="' + q(desc) + '">'
    );
  // 作品图是实际 PNG，尺寸未知——移除模板中的固定 width/height/type，避免误导爬虫
  if (!usingDefault) {
    html = html
      .replace(/<meta property="og:image:type"[^>]*>\n?/g, '')
      .replace(/<meta property="og:image:width"[^>]*>\n?/g, '')
      .replace(/<meta property="og:image:height"[^>]*>\n?/g, '');
  }
  return html.replace('var workData = null;',
    'var workData = ' + JSON.stringify({ id: workId, name, url: imgUrl, date }) + '; window.__WORK_DATA__ = workData;');
}
app.get('/work.html', async (req, res) => {
  const workId = req.query.work;
  if (!workId) return res.sendFile(path.join(ROOT_DIR, 'web-gallery', 'work.html'));
  const origin = getSiteOrigin(req);
  // 优先 CMS 查询
  if (workId.startsWith('cms_')) {
    try {
      const mediaId = workId.replace(/^cms_/, '');
      const info = await cmsRequest('/activity-albums/media/' + mediaId);
      const name = info.mediaName || '';
      const rawImg = info.cutoutUrl || info.mediaUrl || '';
      const date = info.createTime ? info.createTime.slice(0, 10).replace(/-/g, '/') : '';
      const absImg = rawImg ? toAbsoluteUrl(rawImg, origin) : '';
      const sizeOk = await isOgImageSizeOk(absImg);
      const imgUrl = sizeOk ? rawImg : ''; // 超限时传空，buildWorkHtml 自动用默认图
      return res.send(buildWorkHtml(workId, name, imgUrl, date, origin));
    } catch (e) {
      // CMS 失败时继续尝试本地
    }
  }
  // 本地作品查询
  const local = artworks.find(a => a.id === workId);
  if (local) {
    const name = local.name || '';
    const rawImg = local.url || '';
    const date = local.date ? local.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3') : '';
    const absImg = rawImg ? toAbsoluteUrl(rawImg, origin) : '';
    const sizeOk = await isOgImageSizeOk(absImg);
    const imgUrl = sizeOk ? rawImg : ''; // 超限时传空，buildWorkHtml 自动用默认图
    return res.send(buildWorkHtml(workId, name, imgUrl, date, origin));
  }
  // 兜底：返回无 SSR 的原始模板（前端 JS 会继续加载）
  res.sendFile(path.join(ROOT_DIR, 'web-gallery', 'work.html'));
});

app.get('/api/artworks',(req,res)=>res.json(getAllArtworks(true)));
app.get('/api/artworks/all',(req,res)=>res.json(getAllArtworks(false)));
app.get('/api/artworks/stats',(req,res)=>{const all=getAllArtworks(false),a=all.filter(x=>x.status==='active').length,b=all.filter(x=>x.status==='archived').length;res.json({total:all.length,active:a,archived:b});});

app.post('/api/artworks/upload',uploadArtwork.single('image'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Please select image'});
  const a={id:path.basename(req.file.filename,path.extname(req.file.filename)),name:req.body.name||'Anonymous',date:req.body.date||new Date().toISOString().slice(0,10).replace(/-/g,''),filename:req.file.filename,url:'/uploads/artworks/'+req.file.filename,status:'active',createdAt:Date.now()};
  artworks.push(a);saveJSON(ARTWORKS_FILE,artworks);track('newArtworks');generateWorksDataJson();io.emit('artwork:new',a);
  res.json({success:true,artwork:a});
});

app.post('/api/artworks/batch',uploadArtwork.array('images',50),(req,res)=>{
  if(!req.files||!req.files.length)return res.status(400).json({error:'Please select images'});
  const nl=req.body.names?JSON.parse(req.body.names):[],dl=req.body.dates?JSON.parse(req.body.dates):[],na=[];
  req.files.forEach((f,i)=>{const a={id:path.basename(f.filename,path.extname(f.filename)),name:nl[i]||'Anonymous',date:dl[i]||new Date().toISOString().slice(0,10).replace(/-/g,''),filename:f.filename,url:'/uploads/artworks/'+f.filename,status:'active',createdAt:Date.now()};artworks.push(a);na.push(a);});
  saveJSON(ARTWORKS_FILE,artworks);track('newArtworks',na.length);generateWorksDataJson();io.emit('artworks:batch',na);
  res.json({success:true,count:na.length,artworks:na});
});

const recentAutoMatting=new Map();
app.post('/api/auto-matting',uploadArtwork.single('image'),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:'No image'});
  const n=req.body.name||'Anonymous',lt=recentAutoMatting.get(n);
  if(lt&&Date.now()-lt<DEDUP_WINDOW){try{fs.unlinkSync(req.file.path);}catch(e){}return res.json({success:false,duplicate:true});}
  recentAutoMatting.set(n,Date.now());
  const id=path.basename(req.file.filename,path.extname(req.file.filename)),op=req.file.path,oe=path.extname(req.file.filename).toLowerCase();
  try{
    const fp=path.join(ORIGINALS_DIR,id+oe);fs.copyFileSync(op,fp);
    const cm=await sharp(fp).metadata(),c=calcCrop(cm),cp=path.join(ORIGINALS_DIR,id+'_c'+oe);await sharp(fp).extract(c).toFile(cp);
    const md=await callRembg(cp),mf=id+'.png',mp=path.join(ARTWORKS_DIR,mf);fs.writeFileSync(mp,md);
    if(op!==mp)try{fs.unlinkSync(op);}catch(e){}
    const a={id,name:n,date:req.body.date||new Date().toISOString().slice(0,10).replace(/-/g,''),filename:mf,url:'/uploads/artworks/'+mf,originalUrl:'/uploads/originals/'+id+'_c'+oe,status:'active',createdAt:Date.now(),autoMatting:true};
    artworks.push(a);saveJSON(ARTWORKS_FILE,artworks);track('newArtworks');generateWorksDataJson();io.emit('artwork:new',a);
    res.json({success:true,matted:true,artwork:a});
  }catch(e){try{fs.unlinkSync(op);}catch(ee){}res.json({success:false,matted:false,error:e.message});}
});

app.put('/api/artworks/:id/archive',(req,res)=>{
  const id = req.params.id;
  // CMS 作品 → 禁用本地缓存
  if (id.startsWith('cms_')) {
    const cache = getCmsCache();
    const mediaId = id.replace('cms_', '');
    cache.albums.forEach(a => { if (a.medias) a.medias.forEach(m => { if (String(m.mediaId) === mediaId) m.enabled = false; }); });
    saveCmsCache(cache);
    io.emit('artwork:archive',{id});
    return res.json({success:true,archived:true,isCms:true});
  }
  const a=artworks.find(x=>x.id===id);if(!a)return res.status(404).json({error:'Not found'});
  a.status='archived';a.archivedAt=Date.now();saveJSON(ARTWORKS_FILE,artworks);
  generateWorksDataJson();
  io.emit('artwork:archive',{id});res.json({success:true,artwork:a});
});
app.put('/api/artworks/:id/restore',(req,res)=>{
  const id = req.params.id;
  if (id.startsWith('cms_')) {
    const cache = getCmsCache();
    const mediaId = id.replace('cms_', '');
    cache.albums.forEach(a => { if (a.medias) a.medias.forEach(m => { if (String(m.mediaId) === mediaId) m.enabled = true; }); });
    saveCmsCache(cache);
    const m = cache.albums.flatMap(a => a.medias || []).find(x => String(x.mediaId) === mediaId);
    io.emit('artwork:restore',{id, artwork:{id, name: m?.mediaName||'', url: m?.mediaUrl||'', status:'active', isCms:true}});
    return res.json({success:true,restored:true,isCms:true});
  }
  const a=artworks.find(x=>x.id===id);if(!a)return res.status(404).json({error:'Not found'});
  a.status='active';delete a.archivedAt;saveJSON(ARTWORKS_FILE,artworks);
  generateWorksDataJson();
  io.emit('artwork:restore',{id, artwork:a});res.json({success:true,restored:true,artwork:a});
});
app.delete('/api/artworks/:id/purge',(req,res)=>{
  const id = req.params.id;
  if (id.startsWith('cms_')) {
    const cache = getCmsCache();
    const mediaId = id.replace('cms_', '');
    cache.albums.forEach(a => { if (a.medias) a.medias = a.medias.filter(m => String(m.mediaId) !== mediaId); });
    saveCmsCache(cache);
    io.emit('artwork:purge',{id});
    return res.json({success:true, purged:true, isCms:true});
  }
  const idx=artworks.findIndex(a=>a.id===id);if(idx===-1)return res.status(404).json({error:'Not found'});
  artworks.splice(idx,1);saveJSON(ARTWORKS_FILE,artworks);
  generateWorksDataJson();
  io.emit('artwork:purge',{id});res.json({success:true});
});
app.post('/api/regenerate-pages',(req,res)=>{generateWorksDataJson();res.json({success:true,message:'Done'});});

// ===== Analytics =====
app.get('/api/analytics/today',(req,res)=>{
  const t=ensureToday();const y=new Date(Date.now()-86400000);const yk=''+y.getFullYear()+String(y.getMonth()+1).padStart(2,'0')+String(y.getDate()).padStart(2,'0');const ys=analytics[yk]||{pageViews:0,visitors:[],newArtworks:0,displayViews:0,shareClicks:0};
  res.json({today:{pageViews:t.pageViews,uniqueVisitors:t.visitors.length,newArtworks:t.newArtworks,displayViews:t.displayViews,shareClicks:t.shareClicks},yesterday:{pageViews:ys.pageViews,uniqueVisitors:ys.visitors.length,newArtworks:ys.newArtworks,displayViews:ys.displayViews,shareClicks:ys.shareClicks}});
});
app.get('/api/analytics/beacon',(req,res)=>{
  const t=ensureToday();
  t.pageViews++;if(req.ip&&!t.visitors.includes(req.ip))t.visitors.push(req.ip);
  saveJSON(ANALYTICS_FILE,analytics);
  res.set('Content-Type','image/gif');res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
});

// ===== Dashboard =====
app.get('/api/dashboard',(req,res)=>{res.json({records:Object.entries(dashboardData).map(([d,x])=>({date:d,...x})).sort((a,b)=>b.date.localeCompare(a.date))});});
app.get('/api/dashboard/today',(req,res)=>{const k=todayKey(),d=dashboardData[k]||{experienceVisitors:0,groupJoins:0,wechatAdds:0,courseSignups:0,notes:''};res.json({date:k,...d});});
app.post('/api/dashboard/today',express.json(),(req,res)=>{
  const k=todayKey();if(!dashboardData[k])dashboardData[k]={};
  ['experienceVisitors','groupJoins','wechatAdds','courseSignups','notes'].forEach(f=>{if(req.body[f]!==undefined)dashboardData[k][f]=f==='notes'?String(req.body[f]):Number(req.body[f])||0;});
  dashboardData[k].updatedAt=Date.now();saveSettingsJSON('dashboard',dashboardData);res.json({success:true,data:dashboardData[k]});
});

// ===== Background（支持 CMS + 本地）=====
app.get('/api/background',(req,res)=>res.json(bgConfig));
app.post('/api/background/upload',uploadBg.single('image'),async (req,res)=>{
  if(!req.file)return res.status(400).json({error:'No file'});
  try {
    // 上传到 CMS
    const cmsFile = { originalname: req.file.originalname, buffer: fs.readFileSync(req.file.path), mimetype: req.file.mimetype, size: req.file.size };
    const uploadResult = await cmsFileUpload(cmsFile);
    // 更新配置
    const oldFile = bgConfig.filename;
    bgConfig.filename = req.file.filename;
    bgConfig.url = uploadResult.url;
    bgConfig.cmsUrl = uploadResult.url;
    saveSettingsJSON('background',bgConfig); io.emit('background:update',bgConfig);
    // 清理旧本地文件
    if(oldFile&&oldFile!==req.file.filename){const p=path.join(BG_DIR,oldFile);if(fs.existsSync(p))try{fs.unlinkSync(p);}catch(e){}}
    res.json({success:true,background:bgConfig,cmsUrl:uploadResult.url});
  } catch(e) {
    // CMS 上传失败，回退本地
    console.warn('[BG] CMS 上传失败，使用本地:', e.message);
    if(bgConfig.filename&&bgConfig.filename!==req.file.filename){const p=path.join(BG_DIR,bgConfig.filename);if(fs.existsSync(p))try{fs.unlinkSync(p);}catch(e){}}
    bgConfig.filename=req.file.filename;bgConfig.url='/uploads/background/'+req.file.filename;saveSettingsJSON('background',bgConfig);io.emit('background:update',bgConfig);
    res.json({success:true,background:bgConfig});
  }
});
app.put('/api/background',express.json(),(req,res)=>{if(req.body.position)bgConfig.position=req.body.position;if(req.body.scale)bgConfig.scale=req.body.scale;saveSettingsJSON('background',bgConfig);io.emit('background:update',bgConfig);res.json({success:true,background:bgConfig});});

// ===== Videos（支持 CMS + 本地）=====
app.get('/api/videos',(req,res)=>res.json(videos));
app.get('/api/videos/config',(req,res)=>res.json({interval:videoConfig.interval,repeat:videoConfig.repeat,enabled:videos.length>0}));
app.post('/api/videos/upload',uploadVideo.single('video'),async (req,res)=>{
  if(!req.file)return res.status(400).json({error:'No video'});
  const v={id:path.basename(req.file.filename,path.extname(req.file.filename)),name:req.body.name||'Video',date:req.body.date||new Date().toISOString().slice(0,10).replace(/-/g,''),filename:req.file.filename,url:'/uploads/videos/'+req.file.filename,createdAt:Date.now()};
  // 尝试上传到 CMS
  try {
    const cmsFile = { originalname: req.file.originalname, buffer: fs.readFileSync(req.file.path), mimetype: req.file.mimetype, size: req.file.size };
    const uploadResult = await cmsFileUpload(cmsFile);
    v.cmsUrl = uploadResult.url;
    v.url = uploadResult.url; // 大屏直接用 CMS URL
  } catch(e) { console.warn('[Video] CMS 上传失败，使用本地:', e.message); }
  videos.push(v);saveJSON(VIDEOS_FILE,videos);io.emit('videos:update',videos);res.json({success:true,video:v});
});
app.delete('/api/videos/:id',(req,res)=>{const idx=videos.findIndex(v=>v.id===req.params.id);if(idx===-1)return res.status(404).json({error:'Not found'});const v=videos[idx];videos.splice(idx,1);saveJSON(VIDEOS_FILE,videos);io.emit('videos:update',videos);const fp=path.join(VIDEOS_DIR,v.filename);if(fs.existsSync(fp))try{fs.unlinkSync(fp);}catch(e){}res.json({success:true});});
app.put('/api/videos/config',express.json(),(req,res)=>{videoConfig.interval=req.body.interval||300;videoConfig.repeat=req.body.repeat||2;saveSettingsJSON('videoConfig',videoConfig);const cfg={interval:videoConfig.interval,repeat:videoConfig.repeat,enabled:videos.length>0};io.emit('videos:config',cfg);res.json({success:true,config:cfg});});

// ===== 本地抠图通知（方案 B：本地 Rembg 完成后通知服务器推大屏）=====
app.post('/api/cms/cutout/notify', express.json(), async (req, res) => {
  try {
    const { albumId, mediaId, mediaName, cutoutUrl, mediaUrl } = req.body;
    if (!mediaId) return res.json({ success: false, error: 'mediaId 必填' });
    // 更新本地缓存
    const cache = getCmsCache();
    const album = cache.albums.find(a => String(a.albumId) === String(albumId || cache.displayAlbumId));
    if (album && album.medias) {
      const m = album.medias.find(mm => String(mm.mediaId) === String(mediaId));
      if (m) { if (cutoutUrl) m.cutoutUrl = cutoutUrl; if (mediaName) m.mediaName = mediaName; }
    }
    saveCmsCache(cache);
    // 推送给大屏
    const workId = 'cms_' + mediaId;
    io.emit('artwork:new', {
      id: workId,
      name: mediaName || '',
      date: new Date().toISOString().slice(0,10).replace(/-/g,''),
      url: cutoutUrl || mediaUrl,
      originalUrl: mediaUrl,
      status: 'active',
      isCms: true
    });
    // 更新静态数据
    generateWorksDataJson();
    res.json({ success: true, workId });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ===== 服务端轮询 CMS 新媒体 =====
// ENABLE_AUTO_CUTOUT=false（默认服务器）: 仅同步缓存，本地 Rembg 通过 notify 推送
// ENABLE_AUTO_CUTOUT=true（本地开发）: 自动加入抠图队列处理
let cmsPollState = { albumId: null, sinceId: 0 };
async function pollCmsNewMedia() {
  const cache = getCmsCache();
  const albumId = cache.displayAlbumId || null;
  if (!albumId) return;
  if (cmsPollState.albumId !== albumId) { cmsPollState.albumId = albumId; cmsPollState.sinceId = 0; }

  // 同步缓存
  async function syncCacheMedia(albumId, medias) {
    const c = getCmsCache();
    let album = c.albums.find(a => String(a.albumId) === albumId);
    if (!album) { album = { albumId, medias: [] }; c.albums.push(album); }
    for (const m of medias) {
      const mediaId = String(m.mediaId || m.id);
      const existing = album.medias.find(mm => String(mm.mediaId) === mediaId);
      if (!existing) {
        album.medias.push({
          mediaId, mediaUrl: m.mediaUrl, sourceUrl: m.sourceUrl,
          mediaName: m.mediaName || '', enabled: true, createTime: m.createTime || new Date().toISOString()
        });
      } else {
        if (m.cutoutUrl) existing.cutoutUrl = m.cutoutUrl;
        if (m.mediaUrl) existing.mediaUrl = m.mediaUrl;
      }
    }
    saveCmsCache(c);
  }

  try {
    const data = await cmsRequest(`/activity-albums/${albumId}/media/check?sinceId=${cmsPollState.sinceId}&limit=20`);
    if (!data || !data.length) return;
    await syncCacheMedia(albumId, data);

    let maxId = cmsPollState.sinceId;
    for (const m of data) {
      const mid = parseInt(m.mediaId || m.id);
      if (mid > maxId) maxId = mid;
      if (m.cutoutUrl) continue;
      if (ENABLE_AUTO_CUTOUT && !cutoutQueue.find(q => String(q.mediaId) === String(mid))) {
        cutoutQueue.push({ albumId, mediaId: String(mid), mediaUrl: m.mediaUrl, sourceUrl: m.sourceUrl, mediaName: m.mediaName || '', status: 'pending', addedAt: Date.now() });
        persistCutoutQueue();
        if (!isProcessingCutout) processCutoutQueue();
      }
    }
    cmsPollState.sinceId = maxId;
    generateWorksDataJson();
  } catch (e) { /* silent */ }
}
setInterval(pollCmsNewMedia, CMS_POLL_INTERVAL);
// 兜底：每 5 分钟全量刷新缓存，防止 notify 失败导致 cache 遗漏
setInterval(async () => {
  const cache = getCmsCache();
  const albumId = cache.displayAlbumId;
  if (!albumId) return;
  try {
    const data = await cmsRequest(`/activity-albums/${albumId}/media?pageSize=200`);
    const rows = data.rows || data || [];
    const c = getCmsCache();
    let album = c.albums.find(a => String(a.albumId) === albumId);
    if (!album) return;
    for (const m of rows) {
      const mid = String(m.mediaId || m.id);
      const existing = album.medias.find(mm => String(mm.mediaId) === mid);
      if (existing && m.cutoutUrl && existing.cutoutUrl !== m.cutoutUrl) {
        existing.cutoutUrl = m.cutoutUrl;
        console.log('[Cache] 补漏 cutoutUrl:', m.mediaName || mid);
      }
    }
    saveCmsCache(c);
  } catch (e) { /* silent */ }
}, 300000);

// ===== Socket.IO =====
io.on('connection',(socket)=>{
  console.log('Client connected:',socket.id);
  socket.emit('sync',{artworks:getAllArtworks(true).filter(function(a) { return a.cutoutUrl; }),background:bgConfig,videos});
  socket.on('display:connected',()=>track('displayViews'));
  socket.on('disconnect',()=>console.log('Disconnected:',socket.id));
});

app.use((err,req,res,next)=>{if(err){console.error(err.message);if(err.code==='LIMIT_FILE_SIZE')return res.status(400).json({error:'File too large'});return res.status(400).json({error:err.message||'Upload failed'});}next();});

// ===== Startup =====
generateWorksDataJson();
server.listen(PORT,()=>{
  const os=require('os'),ifs=os.networkInterfaces();let ip='localhost';
  for(const i of Object.values(ifs))for(const a of i)if(a.family==='IPv4'&&!a.internal){ip=a.address;break;}
  console.log('========================================');
  console.log('  Dunhuang AIGC Art Exhibition');
  console.log('  Server on port '+PORT);
  console.log('========================================');
  console.log('  Display: http://localhost:'+PORT+'/display');
  console.log('  Admin:   http://localhost:'+PORT+'/admin');
  console.log('  Gallery: http://localhost:'+PORT+'/gallery');
  console.log('  Mobile:  http://'+ip+':'+PORT+'/work/{id}');
  console.log('========================================');
});
