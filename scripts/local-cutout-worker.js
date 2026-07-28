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
 *   3. 启动 Rembg 服务：start-rembg.bat
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
const POLL_INTERVAL = config.pollInterval || 15000;

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

// ===== 通知服务器推大屏 =====
async function notifyServer(albumId, mediaId, mediaName, cutoutUrl, mediaUrl) {
  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId, mediaId, mediaName, cutoutUrl, mediaUrl })
    });
  } catch (e) {
    console.warn('[Worker] 通知服务器失败:', e.message);
  }
}

// ===== 处理单个媒体 =====
async function processMedia(albumId, media) {
  const mediaId = String(media.mediaId || media.id);
  const mediaUrl = media.cutoutUrl || media.mediaUrl || media.sourceUrl;

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
    console.warn(`[Worker] Rembg 失败，使用原图:`, e.message);
    mattedBuffer = buf;
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

// ===== 主循环 =====
async function mainLoop() {
  try {
    const albumId = await getDisplayAlbumId();
    if (!albumId) {
      console.log('[Worker] 未设置展示相册，等待...');
      return;
    }

    console.log(`[Worker] 检查展示相册 #${albumId}...`);

    // 获取相册所有媒体
    const data = await cmsFetch(`/activity-albums/${albumId}/media?pageSize=200`);
    const rows = data.rows || data || [];

    // 筛选没有扣图结果的
    const needsCutout = rows.filter(m => !m.cutoutUrl);

    if (needsCutout.length === 0) return;

    console.log(`[Worker] 发现 ${needsCutout.length} 个待抠图媒体`);

    // 逐个处理
    for (const media of needsCutout) {
      try {
        await processMedia(albumId, media);
      } catch (e) {
        console.error(`[Worker] ❌ ${media.mediaName || media.mediaId}: ${e.message}`);
      }
    }

    console.log(`[Worker] 本轮完成`);
  } catch (e) {
    // 静默处理（网络波动等）
  }
}

// ===== 启动 =====
console.log('========================================');
console.log('  Local Cutout Worker');
console.log('  轮询间隔: ' + (POLL_INTERVAL / 1000) + 's');
console.log('  Rembg: ' + REMBG_HOST + ':' + REMBG_PORT);
console.log('  通知: ' + NOTIFY_URL);
console.log('========================================');

// 首次立即执行
mainLoop();

// 定时轮询
setInterval(mainLoop, POLL_INTERVAL);
