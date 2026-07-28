/**
 * 相册数据初始化脚本 v4
 *
 * 三种模式：
 *   1. 单文件：              node scripts/init-album-data.js <相册ID> <图片路径> [作品名称]
 *   2. 文件夹批量：           node scripts/init-album-data.js <相册ID> <文件夹路径>
 *   3. 刷新 works-data.json： node scripts/init-album-data.js --works-data
 *
 * 裁剪设置（设计卡 102mm×152mm 物理比例）：
 *   上边距 5.26%  下边距 21.05%  左边距 7.84%  右边距 7.84%
 *   cropX = w × 7.84%   cropY = h × 5.26%
 *   cropW = w × 84.32%  cropH = h × 73.69%
 *
 * 流程：上传 → 服务端裁剪 → 添加到相册 → AI抠图 → 写入 works-data.json
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// ===== 裁剪配置 =====
const CROP = { top: 5.26, bottom: 21.05, left: 7.84, right: 7.84 };

// ===== 祝福语池（未传名称时随机选用） =====
const BLESSINGS = [
  '开心', '如意', '平安', '健康', '自在',
  '加油', '微笑', '快乐', '美好', '阳光',
  '温暖', '幸运', '幸福', '甜蜜', '灿烂',
  '从容', '坦荡', '明亮', '温柔', '坚定',
  '勇敢', '赤诚', '热烈', '浪漫', '纯粹',
  '做自己', '放轻松', '慢慢来', '没关系', '你真棒',
  '小确幸', '好心情', '有梦想', '爱生活', '在路上',
  '天天开心', '万事胜意', '百事无忧',
  '闪闪发光', '人间值得', '好好生活', '天天向上',
  '保持热爱', '奔赴山海', '万物可爱', '未来可期',
  '好事发生', '如约而至', '满心欢喜', '来日方长',
  '不负春光', '心中有光', '一往无前', '平安喜乐',
  '前程似锦', '梦想成真', '如愿以偿', '得偿所愿',
  '自由自在', '无忧无虑', '心之所向', '光芒万丈',
  '乘风破浪', '星辰大海', '锦绣前程', '未来已来',
  '开心每一天', '生活明朗', '好运常在', '天天好心情',
  '笑口常开', '日子滚烫', '人间烟火', '山河远阔',
  '眼里有光', '心中有爱', '脚下有路', '未来有梦',
  '你要快乐', '记得微笑', '今天很好', '明天更好',
  '生活很好', '记得开心', '顺顺利利', '健健康康'
];

// ===== 工具函数 =====

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** 调用本地 server API */
function api(method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3000, path: urlPath, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`非JSON响应 (${res.status}): ${d.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('超时')); });
    if (body) req.write(body);
    req.end();
  });
}

/** 上传文件到 CMS，返回 {url, width, height} */
async function uploadToCms(imagePath) {
  const fileBuf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  // CMS 限制文件名最长 100 字符，超长文件用随机名
  let fileName = path.basename(imagePath);
  if (Buffer.byteLength(fileName, "utf8") > 80) fileName = crypto.randomBytes(12).toString("hex") + ext;

  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'application/octet-stream';
  const boundary = '------Up' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

  const parts = [];
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`
  ));
  parts.push(fileBuf);
  parts.push(Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\noriginal\r\n--${boundary}--\r\n`
  ));
  const body = Buffer.concat(parts);

  const result = await api('POST', '/api/cms/upload', {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': body.length
  }, body);

  if (!result.success) throw new Error(result.error || '上传失败');
  return { url: result.url, width: result.width, height: result.height };
}

/** 添加媒体到相册（JSON + 裁剪参数） */
async function addMediaToAlbum(albumId, mediaUrl, width, height, mediaName) {
  const cropX = Math.round(width * CROP.left / 100);
  const cropY = Math.round(height * CROP.top / 100);
  const cropW = Math.round(width * (100 - CROP.left - CROP.right) / 100);
  const cropH = Math.round(height * (100 - CROP.top - CROP.bottom) / 100);

  const body = JSON.stringify({
    mediaUrl, mediaType: 'image', mediaName,
    sourceUrl: mediaUrl,
    cropX, cropY, cropWidth: cropW, cropHeight: cropH
  });

  const result = await api('POST', `/api/cms/albums/${albumId}/media/add-url`, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }, body);

  if (!result.success) throw new Error(result.error || '添加失败');
  return { mediaId: result.media?.mediaId, workId: result.media?.id, mediaName };
}

/** 触发抠图 */
async function triggerCutout(albumId, mediaId) {
  const body = JSON.stringify({});
  try {
    const result = await api('POST', `/api/cms/cutout/${albumId}/${mediaId}`, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }, body);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** 扫描文件夹中所有图片 */
function scanImages(dirPath) {
  const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
  const files = [];
  try {
    for (const f of fs.readdirSync(dirPath)) {
      const fp = path.join(dirPath, f);
      if (fs.statSync(fp).isFile() && exts.has(path.extname(f).toLowerCase())) {
        files.push(fp);
      }
    }
  } catch (e) {
    console.error(`  ❌ 读取文件夹失败: ${e.message}`);
    process.exit(1);
  }
  return files.sort();
}

/** 获取图片尺寸 */
async function getImageSize(imagePath) {
  try {
    const sharp = require('sharp');
    const meta = await sharp(imagePath).metadata();
    return { width: meta.width, height: meta.height };
  } catch (e) {
    throw new Error('sharp 不可用，请 npm install sharp');
  }
}

/** 刷新 works-data.json */
async function regenerateWorksData() {
  try {
    const result = await api('POST', '/api/regenerate-pages', { 'Content-Type': 'application/json' }, JSON.stringify({}));
    return result.success;
  } catch (e) {
    return false;
  }
}

// ===== 模式1：处理单文件 =====
async function processSingleFile(albumId, imagePath, workName) {
  const name = workName || pick(BLESSINGS);
  const size = await getImageSize(imagePath);

  console.log(`  图片:       ${path.basename(imagePath)}`);
  console.log(`  尺寸:       ${size.width}×${size.height}`);
  console.log(`  作品:       ${name}`);
  console.log('');

  console.log('  📤 上传到 CMS ...');
  const up = await uploadToCms(imagePath);
  console.log(`     URL: ${up.url}`);

  console.log('  📦 添加到相册 ...');
  const media = await addMediaToAlbum(albumId, up.url, size.width, size.height, name);
  console.log(`     mediaId: ${media.mediaId}  ${media.mediaName}`);

  console.log('  🎨 触发抠图 ...');
  const cut = await triggerCutout(albumId, media.mediaId);
  console.log(`     ${cut.message || (cut.success ? '已加入队列' : '跳过')}`);

  return { imagePath, name, mediaId: media.mediaId };
}

// ===== 模式2：处理文件夹 =====
async function processFolder(albumId, dirPath) {
  const files = scanImages(dirPath);
  if (files.length === 0) {
    console.error('  ❌ 文件夹中没有图片');
    process.exit(1);
  }

  console.log(`  找到 ${files.length} 张图片\n`);

  const results = [];
  let failCount = 0;
  for (let i = 0; i < files.length; i++) {
    const fp = files[i];
    const name = pick(BLESSINGS);
    console.log(`  [${i + 1}/${files.length}] ${path.basename(fp)} → "${name}"`);
    try {
      const size = await getImageSize(fp);
      const up = await uploadToCms(fp);
      const media = await addMediaToAlbum(albumId, up.url, size.width, size.height, name);
      await triggerCutout(albumId, media.mediaId);
      console.log(`     mediaId: ${media.mediaId} ✓`);
      results.push({ file: fp, name, mediaId: media.mediaId });
    } catch (e) {
      console.log(`     ❌ ${e.message}`);
      failCount++;
    }
  }

  if (failCount > 0) console.log(`\n  ⚠ ${failCount} 个文件跳过`);
  return results;
}

// ===== 主流程 =====
async function main() {
  const args = process.argv.slice(2);

  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║    敦煌AIGC艺术展 · 相册初始化脚本     ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  if (args[0] === '--works-data') {
    console.log('  模式: 刷新 works-data.json\n');
    const ok = await regenerateWorksData();
    console.log(`  ${ok ? '✅ works-data.json 已刷新' : '❌ 刷新失败'}`);
    console.log('');
    return;
  }

  if (args.length < 2) {
    console.log('  用法:');
    console.log('  单文件:  node scripts/init-album-data.js <相册ID> <图片路径> [作品名称]');
    console.log('  文件夹:  node scripts/init-album-data.js <相册ID> <文件夹路径>');
    console.log('  刷新:    node scripts/init-album-data.js --works-data\n');
    process.exit(1);
  }

  const albumId = args[0];
  const targetPath = path.resolve(args[1]);
  const thirdArg = args[2];

  if (!fs.existsSync(targetPath)) {
    console.error(`  ❌ 路径不存在: ${targetPath}`);
    process.exit(1);
  }

  const isDir = fs.statSync(targetPath).isDirectory();

  console.log(`  相册 ID:    ${albumId}`);
  console.log(`  裁剪配置:   上=${CROP.top}% 下=${CROP.bottom}% 左=${CROP.left}% 右=${CROP.right}%`);
  console.log('');

  try {
    const test = await api('GET', '/api/cms/test');
    if (!test.success) throw new Error(test.error || '连接失败');
    console.log(`  平台:       ${test.tenant?.platformName || '?'}`);
    console.log('');
  } catch (e) {
    console.error(`  ❌ 本地服务连接失败: ${e.message}`);
    console.error('     请确保 node server.js 已启动');
    process.exit(1);
  }

  let totalProcessed = 0;

  if (isDir) {
    console.log('  ── 模式: 文件夹批量 ──\n');
    const results = await processFolder(albumId, targetPath);
    totalProcessed = results.length;

    console.log(`\n  ✅ 批量处理完成: ${totalProcessed} 个作品`);
    results.forEach(r => console.log(`     ${r.name} → mediaId: ${r.mediaId}`));

  } else {
    console.log('  ── 模式: 单文件 ──\n');
    await processSingleFile(albumId, targetPath, thirdArg);
    totalProcessed = 1;
  }

  console.log('\n  📋 刷新画廊数据 ...');
  const refreshed = await regenerateWorksData();
  console.log(`  ${refreshed ? '✅ works-data.json 已更新' : '⚠ 刷新失败'}`);

  try {
    const q = await api('GET', '/api/cms/cutout/queue');
    const pending = q.items.filter(x => x.status === 'pending').length;
    const processing = q.processing;
    const done = q.items.filter(x => x.status === 'done').length;
    console.log(`  📊 抠图队列: ${done} 已完成, ${pending} 待处理${processing ? ' (处理中)' : ''}`);
  } catch (e) { /* ignore */ }

  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log(`║   ✅  处理完成: ${totalProcessed} 个作品               ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log('  大屏:  http://localhost:3000/display');
  console.log('  画廊:  http://localhost:3000/gallery');
  console.log('  管理:  http://localhost:3000/admin');
  console.log('');
}

main().catch(e => {
  console.error(`\n  ❌ 脚本异常: ${e.message}`);
  process.exit(1);
});
