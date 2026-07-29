/**
 * 本地抠图工作脚本
 *
 * 在你的本地电脑上运行（需要 Python Rembg 服务）：
 *   1. 读取配置文件（scripts/local-cutout-config.json）
 *   2. 定时轮询 CMS，发现没有 cutoutUrl 的新媒体
 *   3. 下载原图 → 调用本地 Rembg → 上传结果到 CMS
 *   4. 通知服务器推送给大屏
 *
 * 使用方法：
 *   1. 复制 local-cutout-config.template.json → local-cutout-config.json
 *   2. 填写 API Key 等配置
 *   3. 启动 Rembg 服务：启动Rembg抠图服务.bat
 *   4. 运行脚本：node scripts/local-cutout-worker.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ===== 加载配置 =====
const CONFIG_FILE = path.join(__dirname, 'local-cutout-config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('请先复制 local-cutout-config.template.json → local-cutout-config.json 并填写配置');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const CMS_API_KEY = config.cms.apiKey;
const CMS_API_BASE = config.cms.apiBase.replace(/\/+$/, '');
const NOTIFY_URL = config.server.notifyUrl;
const DISPLAY_ALBUM_URL = config.server.displayAlbumUrl;
const REMBG_HOST = config.rembg.host;
const REMBG_PORT = config.rembg.port;
const POLL_INTERVAL = config.pollInterval || 5000;

// ===== CMS API 请求 =====
async function cmsFetch(path, options = {}) {
  const url = CMS_API_BASE + path;
  const headers = { 'X-Api-Key': CMS_API_KEY, ...options.headers };
  const resp = await fetch(url, { ...options, headers });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(data.message || `CMS error (code=${data.code})`);
  return data.data;
}

// ===== 获取展示相册 ID =====
async function getDisplayAlbumId() {
  try {
    const resp = await fetch(DISPLAY_ALBUM_URL);
    const data = await resp.json();
    return data.albumId || null;
  } catch (e) {
    console.warn('[Worker] 无法获取展示相册 ID，请在配置中指定 albumId');
    return null;
  }
}

// ===== 调用本地 Rembg 抠图 =====
async function callRembg(imagePath) {
  const fs = require('fs');
  const d = fs.readFileSync(imagePath);
  const fn = path.basename(imagePath);
  const boundary = '----Rembg' + Math.random().toString(36).slice(2, 10);
  const hdr = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + fn + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
  const ftr = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([hdr, d, ftr]);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: REMBG_HOST, port: REMBG_PORT,
      path: '/api/remove', method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
      }
    }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('Rembg HTTP ' + res.statusCode)); return; }
      const c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Rembg timeout')); });
    req.write(body); req.end();
  });
}

// ===== 上传文件到 CMS =====
async function cmsFileUpload(fileBuffer, filename) {
  const boundary = '----CMS' + Math.random().toString(36).slice(2, 10);
  const hdr = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: image/png\r\n\r\n');
  const ftr = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([hdr, fileBuffer, ftr]);

  const url = CMS_API_BASE + '/files/upload';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Api-Key': CMS_API_KEY,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
    },
    body
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error('文件上传失败: ' + data.message);
  return data.data;
}

// ===== 通知服务器推大屏（失败重试 3 次）=====
async function notifyServer(albumId, mediaId, mediaName, cutoutUrl, mediaUrl) {
  for (var i = 0; i < 3; i++) {
    try {
      var r = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId, mediaId, mediaName, cutoutUrl, mediaUrl })
      });
      if (r.ok) return;
      console.warn('[Worker] 通知服务器返回异常 (' + r.status + ')，重试 ' + (i + 1) + '/3');
    } catch (e) {
      if (i < 2) console.warn('[Worker] 通知服务器失败 (' + e.message + ')，重试 ' + (i + 1) + '/3');
      else console.error('[Worker] 通知服务器失败已达上限:', e.message);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ===== 处理单个媒体 =====
async function processMedia(albumId, media) {
  const mediaId = String(media.mediaId || media.id);
  const mediaUrl = media.mediaUrl || media.sourceUrl;

  console.log(`[Worker] 开始抠图: ${media.mediaName || mediaId}`);

  // 1. 下载原图
  const resp = await fetch(mediaUrl);
  if (!resp.ok) throw new Error('下载失败 HTTP ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());

  // 2. 保存临时文件
  const ext = '.jpg';
  const tmpFile = path.join(__dirname, 'temp', mediaId + ext);
  if (!fs.existsSync(path.join(__dirname, 'temp'))) fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
  fs.writeFileSync(tmpFile, buf);

  // 3. Rembg 抠图
  let mattedBuffer;
  try {
    mattedBuffer = await callRembg(tmpFile);
    console.log(`[Worker] Rembg 完成: ${media.mediaName || mediaId}`);
  } catch (e) {
    console.warn(`[Worker] Rembg 不可用，跳过 ${media.mediaName || mediaId}:`, e.message);
    try { fs.unlinkSync(tmpFile); } catch (e2) {}
    return; // 跳过，不写 cutoutUrl，下次轮询继续
  }

  // 4. 上传抠图结果到 CMS
  const uploadResult = await cmsFileUpload(mattedBuffer, 'cutout_' + mediaId + '.png');

  // 5. 写入 cutoutUrl 到 CMS
  await cmsFetch(`/activity-albums/${albumId}/media/${mediaId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cutoutUrl: uploadResult.url })
  });

  // 6. 通知服务器
  await notifyServer(albumId, mediaId, media.mediaName, uploadResult.url, media.mediaUrl);

  // 7. 清理临时文件
  try { fs.unlinkSync(tmpFile); } catch (e) {}

  console.log(`[Worker] ✅ ${media.mediaName || mediaId} → ${uploadResult.url}`);
}

// ===== 增量轮询状态（持久化，重启不丢进度）=====
const POLL_STATE_FILE = path.join(__dirname, 'temp', 'poll-state.json');
function loadPollState() {
  try { return JSON.parse(fs.readFileSync(POLL_STATE_FILE, 'utf8')); } catch (e) { return { albumId: null, sinceId: 0 }; }
}
function savePollState(state) {
  try {
    if (!fs.existsSync(path.join(__dirname, 'temp'))) fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    fs.writeFileSync(POLL_STATE_FILE, JSON.stringify(state));
  } catch (e) { /* 写文件失败不影响运行 */ }
}
let pollState = loadPollState();

// ===== 互斥锁 + 去重 =====
let isRunning = false;                 // 防止增量/全量同时跑
const processingIds = new Set();      // 正在处理的 mediaId，避免重复

// ===== 处理一批待抠图媒体（去重 + 逐个处理）=====
async function processBatch(albumId, mediaList) {
  for (const media of mediaList) {
    const mediaId = String(media.mediaId || media.id);
    if (processingIds.has(mediaId)) continue; // 已在处理中，跳过
    processingIds.add(mediaId);
    try {
      await processMedia(albumId, media);
    } catch (e) {
      console.error(`[Worker] ❌ ${media.mediaName || mediaId}: ${e.message}`);
    } finally {
      processingIds.delete(mediaId);
    }
  }
}

// ===== 主循环（增量 5s）=====
async function mainLoop() {
  if (isRunning) return;
  isRunning = true;
  try {
    const albumId = await getDisplayAlbumId();
    if (!albumId) return;

    // 切换相册时重置 sinceId
    if (pollState.albumId !== albumId) {
      pollState.albumId = albumId;
      pollState.sinceId = 0;
      savePollState(pollState);
      console.log('[Worker] 切换到相册 #' + albumId);
    }

    // 增量拉取新媒体
    const data = await cmsFetch(`/activity-albums/${albumId}/media/check?sinceId=${pollState.sinceId}&limit=20`);
    if (!data || !data.length) return;

    // 更新 sinceId（取本次最大 ID）
    let maxId = pollState.sinceId;
    for (const m of data) {
      const mid = parseInt(m.mediaId || m.id);
      if (mid > maxId) maxId = mid;
    }
    pollState.sinceId = maxId;
    savePollState(pollState);

    // 筛选需要抠图的
    const needsCutout = data.filter(m => !m.cutoutUrl);
    if (needsCutout.length === 0) return;

    console.log(`[Worker][增量] 发现 ${needsCutout.length} 个待抠图媒体`);
    await processBatch(albumId, needsCutout);
  } catch (e) {
    // 静默处理（网络波动等）
  } finally {
    isRunning = false;
  }
}

// ===== 全量兜底扫描（5 分钟）=====
async function fullScan() {
  if (isRunning) return;
  isRunning = true;
  try {
    const albumId = await getDisplayAlbumId();
    if (!albumId) return;

    console.log('[Worker][全量] 开始对账...');

    // 全量拉取当前相册所有媒体
    const data = await cmsFetch(`/activity-albums/${albumId}/media?pageSize=200`);
    const rows = data.rows || data || [];

    // 找到还没有抠图的
    const missing = rows.filter(m => !m.cutoutUrl);
    if (missing.length === 0) {
      console.log('[Worker][全量] 全部已抠图，无需补漏');
      return;
    }

    // 去重：只处理不在 processingIds 中的
    const todo = missing.filter(m => !processingIds.has(String(m.mediaId || m.id)));
    if (todo.length === 0) {
      console.log('[Worker][全量] 发现 ' + missing.length + ' 个待抠图，但都在处理中');
      return;
    }

    console.log(`[Worker][全量] 补漏 ${todo.length} 个（增量遗漏）`);
    await processBatch(albumId, todo);
    console.log('[Worker][全量] 对账完成');
  } catch (e) {
    // 静默
  } finally {
    isRunning = false;
  }
}

// ===== 启动 =====
console.log('========================================');
console.log('  Local Cutout Worker');
console.log('  增量轮询: ' + (POLL_INTERVAL / 1000) + 's');
console.log('  全量兜底: 5min');
console.log('  Rembg: ' + REMBG_HOST + ':' + REMBG_PORT);
console.log('  通知: ' + NOTIFY_URL);
console.log('========================================');

// 首次立即执行
mainLoop();

// 定时增量轮询
setInterval(mainLoop, POLL_INTERVAL);

// 定时全量兜底（5 分钟）
setInterval(fullScan, 300000);
