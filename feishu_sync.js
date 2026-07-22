/**
 * 飞书多维表格 → 投屏系统 自动同步服务
 * 每30秒轮询飞书表格，发现新作品自动下载图片并推送到投屏系统
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ===== 配置 =====
const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const APP_TOKEN = process.env.FEISHU_APP_TOKEN || '';
const TABLE_ID = process.env.FEISHU_TABLE_ID || '';
const POLL_INTERVAL = 30000; // 30秒轮询一次
const DISPLAY_SERVER = 'http://localhost:3000';

// ===== 状态 =====
let accessToken = null;
let tokenExpiry = 0;
const SYNCED_FILE = path.join(__dirname, 'data', 'feishu_synced.json');

function loadData(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return fallback;
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let syncedRecords = loadData(SYNCED_FILE, {});

// ===== HTTP 工具 =====
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('请求超时'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ===== 飞书 API =====
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const body = JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET });
  const res = await httpsRequest('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body
  });

  const data = JSON.parse(res.body);
  if (data.code !== 0) throw new Error('获取token失败: ' + data.msg);

  accessToken = data.tenant_access_token;
  tokenExpiry = Date.now() + (data.expire - 300) * 1000;
  return accessToken;
}

async function fetchAllRecords() {
  const token = await getAccessToken();
  let allRecords = [];
  let pageToken = '';

  do {
    let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=100`;
    if (pageToken) url += `&page_token=${pageToken}`;

    const res = await httpsRequest(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = JSON.parse(res.body);
    if (data.code !== 0) throw new Error('获取记录失败: ' + data.msg);

    allRecords = allRecords.concat(data.data.items || []);
    pageToken = data.data.has_more ? data.data.page_token : '';
  } while (pageToken);

  return allRecords;
}

async function downloadImage(fileToken) {
  const token = await getAccessToken();
  const url = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`;
  const res = await httpsRequest(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (res.statusCode !== 200) {
    const errBody = res.body.toString('utf8').slice(0, 200);
    throw new Error(`下载图片失败: HTTP ${res.statusCode} - ${errBody}`);
  }
  return res.body; // Buffer
}

// ===== 投屏系统 API =====
async function uploadToDisplay(imageBuffer, name, date, filename) {
  // 构建 multipart/form-data
  const boundary = '----SyncBoundary' + Math.random().toString(36).slice(2);
  const headerText = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
  const nameText = `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`;
  const dateText = `--${boundary}\r\nContent-Disposition: form-data; name="date"\r\n\r\n${date}\r\n`;
  const endText = `--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(headerText),
    imageBuffer,
    Buffer.from('\r\n'),
    Buffer.from(nameText),
    Buffer.from(dateText),
    Buffer.from(endText)
  ]);

  return new Promise((resolve, reject) => {
    const req = http.request(`${DISPLAY_SERVER}/api/artworks/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success) resolve(json.artwork);
          else reject(new Error(json.error || '上传失败'));
        } catch (e) {
          reject(new Error('投屏系统返回异常: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== 工具函数 =====
function msToDate(ms) {
  if (!ms) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function checkDisplayServer() {
  return new Promise((resolve) => {
    http.get(`${DISPLAY_SERVER}/api/artworks`, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

// ===== 同步逻辑 =====
async function syncNewRecords() {
  // 检查投屏系统是否在运行
  const serverOk = await checkDisplayServer();
  if (!serverOk) {
    console.log('⏳ 投屏系统未启动，等待中...');
    return;
  }

  const records = await fetchAllRecords();
  let newCount = 0;
  let skipCount = 0;

  for (const record of records) {
    const recordId = record.record_id;
    if (syncedRecords[recordId]) {
      skipCount++;
      continue;
    }

    const name = (record.fields['姓名+作品'] || '匿名小画家').trim();
    const attachments = record.fields['图片'];
    const date = msToDate(record.fields['日期']);

    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      console.log(`  ⏭ 跳过 "${name}"（无图片）`);
      syncedRecords[recordId] = { skipped: true, name, at: new Date().toISOString() };
      saveData(SYNCED_FILE, syncedRecords);
      continue;
    }

    const fileToken = attachments[0].file_token;
    const filename = attachments[0].name || `${recordId}.png`;

    try {
      console.log(`  ⬇ 下载: ${name} (${(attachments[0].size / 1024 / 1024).toFixed(1)}MB) ...`);
      const imageBuffer = await downloadImage(fileToken);
      console.log(`  ⬆ 上传到投屏系统 ...`);
      await uploadToDisplay(imageBuffer, name, date, filename);

      syncedRecords[recordId] = {
        name, date, filename,
        syncedAt: new Date().toISOString()
      };
      saveData(SYNCED_FILE, syncedRecords);
      newCount++;
      console.log(`  ✅ 已同步: ${name}`);
    } catch (e) {
      console.error(`  ❌ 同步失败 "${name}": ${e.message}`);
      // 不标记为已同步，下次重试
    }
  }

  if (newCount > 0) {
    console.log(`\n🎉 本轮同步完成: 新增 ${newCount} 张，跳过 ${skipCount} 张已同步\n`);
  }
}

// ===== 主程序 =====
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  飞书多维表格 → 投屏系统 自动同步服务        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  轮询间隔: ${String(POLL_INTERVAL / 1000).padEnd(4)}秒                          ║`);
  console.log(`║  投屏服务: ${DISPLAY_SERVER}                    ║`);
  console.log(`║  已同步记录: ${String(Object.keys(syncedRecords).length).padEnd(3)} 条                       ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 初始同步
  try {
    console.log('🔄 开始初始同步...');
    await syncNewRecords();
  } catch (e) {
    console.error('初始同步失败:', e.message);
  }

  // 定时轮询
  setInterval(async () => {
    try {
      await syncNewRecords();
    } catch (e) {
      console.error('轮询出错:', e.message);
    }
  }, POLL_INTERVAL);

  console.log('⏱ 同步服务运行中，每30秒检查飞书新作品...\n');
}

main();
