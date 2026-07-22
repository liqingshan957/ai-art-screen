const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// ===== 目录准备 =====
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const ARTWORKS_DIR = path.join(UPLOADS_DIR, 'artworks');
const BG_DIR = path.join(UPLOADS_DIR, 'background');
const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
const WORKS_DIR = path.join(__dirname, 'public', 'works');
const DATA_DIR = path.join(__dirname, 'data');

// PageFire 公网部署目录
const PAGEFIRE_DIR = path.join(__dirname, 'deploy-pagefire');
const PAGEFIRE_WORKS_DIR = path.join(PAGEFIRE_DIR, 'works');
const PAGEFIRE_ARTWORKS_DIR = path.join(PAGEFIRE_DIR, 'artworks');
const PAGEFIRE_BASE_URL = 'https://gzart-o8114r7d.pagefire.openhkt.com';

[UPLOADS_DIR, ARTWORKS_DIR, BG_DIR, VIDEOS_DIR, WORKS_DIR, DATA_DIR, PAGEFIRE_DIR, PAGEFIRE_WORKS_DIR, PAGEFIRE_ARTWORKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ===== 数据文件 =====
const ARTWORKS_FILE = path.join(DATA_DIR, 'artworks.json');
const BG_FILE = path.join(DATA_DIR, 'background.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const VIDEOS_CONFIG_FILE = path.join(DATA_DIR, 'videos_config.json');

function loadData(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('读取数据失败:', e); }
  return fallback;
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let artworks = loadData(ARTWORKS_FILE, []);
let bgConfig = loadData(BG_FILE, { filename: null, position: 'center', scale: 'cover' });
let videos = loadData(VIDEOS_FILE, []);
let videoConfig = loadData(VIDEOS_CONFIG_FILE, { interval: 300, repeat: 2 });

// ===== 访问统计 / 引流看板 =====
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
let analytics = loadData(ANALYTICS_FILE, {});

// ===== 数据看板(手动填写) =====
const DASHBOARD_FILE = path.join(DATA_DIR, 'dashboard.json');
let dashboardData = loadData(DASHBOARD_FILE, {});

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function ensureToday() {
  const key = todayKey();
  if (!analytics[key]) {
    analytics[key] = { pageViews: 0, visitors: [], newArtworks: 0, displayViews: 0, shareClicks: 0 };
  }
  return analytics[key];
}
function trackPageView(ip) {
  const today = ensureToday();
  today.pageViews++;
  if (!today.visitors.includes(ip)) today.visitors.push(ip);
  saveData(ANALYTICS_FILE, analytics);
}
function trackNewArtwork(count) {
  const today = ensureToday();
  today.newArtworks += count;
  saveData(ANALYTICS_FILE, analytics);
}
function trackDisplayView() {
  const today = ensureToday();
  today.displayViews++;
  saveData(ANALYTICS_FILE, analytics);
}
function trackShareClick() {
  const today = ensureToday();
  today.shareClicks++;
  saveData(ANALYTICS_FILE, analytics);
}

// IP 获取
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// 向后兼容:所有已有作品没有 status 的默认设为 active
artworks = artworks.map(a => ({ ...a, status: a.status || 'active' }));
if (artworks.some(a => !a.status)) saveData(ARTWORKS_FILE, artworks);

// 归档记录文件(永久保留,永不删除)
const ARCHIVE_FILE = path.join(DATA_DIR, 'artworks_archive.json');
let archive = loadData(ARCHIVE_FILE, []);

// ===== Multer 配置 =====
const artworkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ARTWORKS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, `${id}${ext}`);
  }
});

const bgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BG_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `background${ext}`);
  }
});

const imageFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(allowed.includes(ext) ? null : new Error('仅支持图片文件'), allowed.includes(ext));
};

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, `${id}${ext}`);
  }
});

const videoFilter = (req, file, cb) => {
  const allowed = ['.mp4', '.webm', '.avi', '.mov', '.mkv'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(allowed.includes(ext) ? null : new Error('仅支持视频文件 (mp4/webm/avi/mov/mkv)'), allowed.includes(ext));
};

const uploadVideo = multer({ storage: videoStorage, fileFilter: videoFilter, limits: { fileSize: 500 * 1024 * 1024 } });

const uploadArtwork = multer({ storage: artworkStorage, fileFilter: imageFilter, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadBg = multer({ storage: bgStorage, fileFilter: imageFilter, limits: { fileSize: 30 * 1024 * 1024 } });

// ===== Multer 错误处理中间件 =====
function multerErrorHandler(err, req, res, next) {
  if (err) {
    console.error('上传错误:', err.message);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件太大,请上传 20MB 以内的图片' });
    }
    return res.status(400).json({ error: err.message || '上传失败' });
  }
  next();
}

// ===== 页面路由 =====
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/', (req, res) => res.redirect('/admin'));

// ===== 手机端作品展示页 =====
app.get('/work/:id', (req, res) => {
  const artwork = artworks.find(a => a.id === req.params.id);
  if (!artwork) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>作品未找到</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#999;font-size:18px;}</style>
      </head><body>作品未找到或已下架</body></html>
    `);
  }
  trackPageView(getClientIP(req));

  const displayDate = artwork.date
    ? `${artwork.date.slice(0,4)}年${artwork.date.slice(4,6)}月${artwork.date.slice(6,8)}日`
    : '';

  res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${artwork.name} 的作品 · 敦煌AIGC艺术展</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background: #1a1410;
      color: #e8d5b0;
      min-height: 100vh;
      display: flex; flex-direction: column; align-items: center;
    }
    .page {
      width: 100%; max-width: 480px;
      display: flex; flex-direction: column; align-items: center;
      padding-bottom: 40px;
    }
    .hero {
      width: 100%;
      position: relative;
    }
    .hero img {
      width: 100%;
      display: block;
      border-bottom: 2px solid #c9a96e;
    }
    .hero-label {
      position: absolute; top: 12px; left: 12px;
      background: rgba(0,0,0,0.55);
      color: #c9a96e;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 12px;
      letter-spacing: 2px;
    }
    .info {
      width: 100%;
      padding: 24px 20px;
      text-align: center;
    }
    .child-name {
      font-size: 26px;
      font-weight: 700;
      color: #f0dda0;
      margin-bottom: 8px;
    }
    .child-name .sub {
      font-size: 16px;
      font-weight: 400;
      color: #c9a96e;
    }
    .date-badge {
      display: inline-block;
      font-size: 13px;
      color: #a8946c;
      margin-top: 8px;
      padding: 2px 14px;
      border: 1px solid #4a3f30;
      border-radius: 20px;
    }
    .footer {
      text-align: center;
      padding: 30px 20px;
      border-top: 1px solid #2a2320;
      width: 100%;
      margin-top: auto;
    }
    .footer .brand {
      font-size: 14px;
      color: #c9a96e;
      letter-spacing: 3px;
    }
    .footer .sub {
      font-size: 12px;
      color: #6b5e4a;
      margin-top: 6px;
    }
    .footer .cta {
      font-size: 12px;
      color: #8a7a5e;
      margin-top: 10px;
    }
    .save-btn {
      display: inline-block;
      margin-top: 20px;
      padding: 12px 32px;
      background: linear-gradient(135deg, #c9a96e, #a08050);
      color: #1a1410;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 24px;
      cursor: pointer;
      letter-spacing: 1px;
      text-decoration: none;
    }
    .save-btn:active {
      opacity: 0.85;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div class="hero-label">AI 共创</div>
      <img src="${artwork.url}" alt="${artwork.name} 的作品" />
    </div>
    <div class="info">
      <div class="child-name">${artwork.name}<span class="sub"> 的AI艺术作品</span></div>
      ${displayDate ? `<div class="date-badge">${displayDate}</div>` : ''}
    </div>
    <button class="save-btn" onclick="saveImage()">保存作品图片</button>
    <div class="footer">
      <div class="brand">敦煌 · AIGC 艺术展</div>
      <div class="sub">大象智绘 AI 科创</div>
      <div class="cta">扫码让孩子体验AI艺术创作</div>
    </div>
  </div>
  <script>
    function saveImage() {
      const link = document.createElement('a');
      link.download = '${artwork.name}_AI作品.png';
      link.href = '${artwork.url}';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  </script>
</body>
</html>
  `);
});

// ===== 静态作品页访问追踪 =====
app.get('/works/:filename', (req, res, next) => {
  if (req.params.filename.endsWith('.html')) {
    trackPageView(getClientIP(req));
  }
  next(); // 继续交给 static 中间件
});

// ===== 静态文件 =====
app.use(express.static(path.join(__dirname, 'public')));

// ===== 静态作品页生成 =====
function generateWorkPage(artwork) {
  const displayDate = artwork.date
    ? `${artwork.date.slice(0,4)}年${artwork.date.slice(4,6)}月${artwork.date.slice(6,8)}日`
    : '';
  const safeName = artwork.name.replace(/"/g, '\"');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${safeName}的AI艺术作品 · 大象智绘AI科创</title>
  <meta property="og:title" content="${safeName}的敦煌AI艺术作品 | 大象智绘AI科创">
  <meta property="og:description" content="大象智绘AI科创 · 10年艺术教育经验×AI创新教育。我在广州美术馆用AI创作了一幅敦煌风格作品,快来看看吧！">
  <meta property="og:image" content="${artwork.url}">
  <meta property="og:type" content="website">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:linear-gradient(180deg,#f8f4ee 0%,#efe8dc 100%);color:#4a3f30;min-height:100vh;display:flex;flex-direction:column;align-items:center;overflow-x:hidden}
    .page{width:100%;max-width:480px;display:flex;flex-direction:column;align-items:center;padding-bottom:50px}
    .brand-header{width:100%;padding:18px 20px 14px;display:flex;align-items:center;gap:14px;border-bottom:1px solid rgba(201,169,110,.2)}
    .brand-header .logo{flex-shrink:0}
    .brand-header .logo img{height:52px;width:auto;display:block}
    .brand-header .brand-text{flex:1;min-width:0}
    .brand-header .brand-name{font-size:17px;font-weight:700;color:#3d3020;letter-spacing:1px}
    .brand-header .brand-tagline{font-size:11px;color:#8a7a5e;margin-top:2px;letter-spacing:.5px}
    .hero{width:100%;position:relative;cursor:pointer}
    .hero a{display:block;position:relative}
    .hero img{width:100%;display:block}
    .hero-label{position:absolute;top:12px;left:12px;background:rgba(74,63,48,.65);color:#f0dda0;font-size:11px;padding:4px 10px;border-radius:12px;letter-spacing:2px;pointer-events:none;z-index:1;backdrop-filter:blur(4px)}
    .hero-tap-hint{position:absolute;bottom:14px;right:14px;background:rgba(74,63,48,.75);color:#f0dda0;font-size:12px;padding:6px 12px;border-radius:18px;pointer-events:none;z-index:1;animation:bounceY 1.5s ease-in-out infinite;display:flex;align-items:center;gap:5px;backdrop-filter:blur(4px)}
    @keyframes bounceY{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    .info{width:100%;padding:18px 20px 8px;text-align:center}
    .child-name{font-size:24px;font-weight:700;color:#3d3020}
    .child-name .sub{font-size:14px;font-weight:400;color:#8a7a5e}
    .date-badge{display:inline-block;font-size:12px;color:#8a7a5e;margin-top:6px;padding:2px 14px;border:1px solid #c9a96e;border-radius:20px}
    .save-tip{width:calc(100% - 40px);max-width:440px;margin:6px 20px 0;text-align:center;padding:8px 14px;background:rgba(201,169,110,.1);border-radius:10px;color:#7a6a52;font-size:12px;line-height:1.6}
    .brand-statement{width:calc(100% - 40px);max-width:440px;margin:18px 20px 0;padding:16px 18px;background:linear-gradient(135deg,rgba(74,63,48,.04),rgba(201,169,110,.08));border-radius:12px;text-align:center}
    .brand-statement .icon{font-size:22px;margin-bottom:6px}
    .brand-statement h4{font-size:14px;color:#3d3020;font-weight:600;margin-bottom:6px;letter-spacing:1px}
    .brand-statement p{font-size:12.5px;color:#7a6a52;line-height:1.8;letter-spacing:.3px}
    .course-cta{width:calc(100% - 40px);max-width:440px;margin:18px 20px 0;background:linear-gradient(135deg,#3d3020,#2a2218);border-radius:16px;padding:22px 18px 18px;text-align:center;box-shadow:0 6px 24px rgba(61,48,32,.18)}
    .course-cta .cta-badge{display:inline-block;font-size:11px;background:rgba(240,221,160,.15);color:#f0dda0;padding:3px 12px;border-radius:10px;letter-spacing:1px;margin-bottom:10px}
    .course-cta h3{font-size:18px;color:#f0dda0;font-weight:700;margin-bottom:6px;letter-spacing:1px}
    .course-cta .desc{font-size:13px;color:#c9a96e;line-height:1.7;margin-bottom:12px}
    .course-cta .features{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
    .course-cta .features span{font-size:11px;color:#c9a96e;background:rgba(201,169,110,.1);padding:4px 10px;border-radius:8px;border:1px solid rgba(201,169,110,.15)}
    .course-cta .price-row{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:16px}
    .course-cta .price-current{font-size:28px;font-weight:700;color:#f0dda0;letter-spacing:1px}
    .course-cta .price-original{font-size:14px;color:#8a7a5e;text-decoration:line-through}
    .course-cta .price-tag{font-size:11px;color:#c9a96e;background:rgba(201,169,110,.15);padding:2px 8px;border-radius:4px}
    .course-cta .cta-btn{display:block;padding:14px 0;background:linear-gradient(135deg,#c9a96e,#a08050);color:#1a1410;font-size:15px;font-weight:700;border:none;border-radius:22px;cursor:pointer;text-decoration:none;text-align:center;letter-spacing:1px;box-shadow:0 4px 12px rgba(201,169,110,.25)}
    .course-cta .cta-btn:active{opacity:.85;transform:scale(.97)}
    .course-cta .urgency{font-size:11px;color:#c9a96e;margin-top:10px;opacity:.8}
    .wechat-card{width:calc(100% - 40px);max-width:440px;margin:14px 20px 0;padding:18px;background:#fff;border:1px solid #e0d5c5;border-radius:14px;text-align:center;box-shadow:0 2px 8px rgba(74,63,48,.04)}
    .wechat-card h4{font-size:14px;color:#3d3020;font-weight:600;margin-bottom:4px}
    .wechat-card .sub{font-size:12px;color:#8a7a5e;margin-bottom:12px;line-height:1.5}
    .wechat-card .qrcode{display:flex;justify-content:center;margin-bottom:8px}
    .wechat-card .qrcode .qr-placeholder{width:120px;height:120px;background:#f8f4ee;border:2px dashed #d4c5aa;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a8946c;font-size:11px;gap:4px;line-height:1.4}
    .wechat-card .social-proof{font-size:11px;color:#a8946c;margin-top:4px}
    .pipeline{width:calc(100% - 40px);max-width:440px;margin:14px 20px 0;padding:18px 16px;background:rgba(201,169,110,.05);border:1px solid #e0d5c5;border-radius:14px;text-align:center}
    .pipeline h4{font-size:13px;color:#3d3020;font-weight:600;margin-bottom:12px;letter-spacing:1px}
    .pipeline-steps{display:flex;flex-direction:column;gap:8px}
    .pipeline .step{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:#5a4f3a}
    .pipeline .step .arrow{color:#c9a96e;font-size:14px}
    .footer{text-align:center;padding:24px 20px 16px;border-top:1px solid #e0d5c5;width:100%;margin-top:auto}
    .footer .brand{font-size:14px;color:#8a7a5e;letter-spacing:3px;font-weight:600}
    .footer .sub{font-size:11px;color:#a8946c;margin-top:4px}
    .footer .contact{font-size:11px;color:#b5a88a;margin-top:6px}
  </style>
</head>
<body>
  <div class="page">
    <div class="brand-header">
      <div class="logo">
        <img src="/logo.png" alt="大象智绘AI科创">
      </div>
      <div class="brand-text">
        <div class="brand-name">大象智绘AI科创</div>
        <div class="brand-tagline">10年艺术教育经验 · AI创新教育引领者</div>
      </div>
    </div>
    <div class="hero">
      <div class="hero-label">AI 共创</div>
      <a href="${artwork.url}" id="img-link">
        <img src="${artwork.url}" alt="${safeName}的作品" />
        <div class="hero-tap-hint">👆 长按保存图片</div>
      </a>
    </div>
    <div class="info">
      <div class="child-name">${safeName}<span class="sub">的AI艺术作品</span></div>
      
    </div>
    <div class="save-tip" id="save-tip">👆 长按上方作品图片 → 选择「保存图片」即可存到手机相册</div>
    <div class="brand-statement">
      <div class="icon">🤖</div>
      <h4>这就是AI+艺术的魔法</h4>
      <p>大象智绘AI科创,深耕艺术教育十余年,融合AI前沿技术,<br>让孩子用想象力触碰未来。这里展出的每一幅作品,<br>都是孩子创意与AI智能的共同杰作。</p>
    </div>
    <div class="course-cta">
      <div class="cta-badge">🔥 热门体验 · 二楼专享</div>
      <h3>🎬 AI微电影创作体验课</h3>
      <p class="desc">用你刚刚创作的敦煌角色,30分钟变身动画短片主角！<br>专业老师全程指导,零基础也能完成大片</p>
      <div class="features">
        <span>✨ AI角色生成</span>
        <span>🎨 场景创作</span>
        <span>📽️ 15秒大片</span>
      </div>
      <div class="price-row">
        <span class="price-current">¥125</span>
        <span class="price-original">¥198</span>
        <span class="price-tag">今日专享</span>
      </div>
      <a class="cta-btn" href="javascript:;" onclick="showCourseModal()">🎯 立即报名二楼课程</a>
      <div class="urgency">⏰ 每场仅限12人 · 请到二楼咨询现场老师</div>
    </div>
    <div class="wechat-card">
      <h4>📱 加微信 · 领高清作品图</h4>
      <p class="sub">扫码添加,在线发送作品高清原图<br>获取更多AI课程资讯与专属福利</p>
      <div class="qrcode">
        <div class="qr-placeholder">
          <span style="font-size:28px">📲</span>
          <span>扫码加微信</span>
          <span style="font-size:10px">请替换为实际二维码</span>
        </div>
      </div>
      <p class="social-proof">已有 200+ 家长在微信社群交流AI艺术创作心得 💬</p>
    </div>
    <div class="pipeline">
      <h4>🎯 大象智绘 · 课程体系</h4>
      <div class="pipeline-steps">
        <div class="step"><span>🆓</span><span>一楼·免费AI体验</span><span class="arrow">▸</span></div>
        <div class="step"><span>🎬</span><span>二楼·¥125 AI微电影课</span><span class="arrow">▸</span></div>
        <div class="step"><span>📚</span><span>暑假班/秋季班·系统学习AI创作</span></div>
      </div>
    </div>
    <div class="footer">
      <div class="brand">大象智绘AI科创中心</div>
      <div class="sub">10年专注 · AI赋能艺术教育</div>
      <div class="contact">📍 广州美术馆二楼研学区 · 现场咨询请联系工作人员</div>
    </div>
  </div>
  <script>
  (function(){
    var ua = navigator.userAgent.toLowerCase();
    var isWechat = ua.indexOf('micromessenger') > -1;
    var tip = document.getElementById('save-tip');
    if (isWechat) {
      tip.innerHTML = '👆 长按上方作品图片 → 选择「保存图片」即可存到手机相册';
    } else {
      tip.innerHTML = '👆 长按上方作品图片 → 选择「保存到相册」即可存到手机';
    }
  })();
  </script>
  <!-- Course enrollment modal -->
  <div id="courseModal" class="course-modal-overlay" style="display:none" onclick="hideCourseModal()">
    <div class="course-modal-box" onclick="event.stopPropagation()">
      <button class="course-modal-close" onclick="hideCourseModal()">✕</button>
      <div style="font-size:40px;margin-bottom:8px">🎬</div>
      <h3 style="font-size:18px;color:#3d3020;margin-bottom:4px">二楼·AI微电影课</h3>
      <p style="font-size:13px;color:#7a6a52;margin-bottom:12px;line-height:1.6">30分钟,让孩子刚才创作的角色<br>变成动画短片主角！</p>
      <div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">✨ AI角色生成</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">🎨 场景创作</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">📽️ 15秒大片</span>
      </div>
      <div style="margin-bottom:14px">
        <strong style="font-size:26px;color:#3d3020">¥125</strong>
        <s style="font-size:14px;color:#aaa;margin-left:8px">原价¥198</s>
      </div>
      <div style="margin-bottom:10px">
        <div style="width:120px;height:120px;background:#f8f4ee;border:2px dashed #d4c5aa;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a8946c;font-size:11px;gap:4px;margin:0 auto">
          <span style="font-size:26px">📲</span>
          <span>扫码加微信</span>
          <span style="font-size:10px">替换实际二维码</span>
        </div>
      </div>
      <p style="font-size:11px;color:#a8946c">发送作品编号,优先预留名额</p>
    </div>
  </div>
  <style>
    .course-modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
    .course-modal-box{background:linear-gradient(135deg,#fff,#faf6ef);max-width:340px;width:88%;border-radius:20px;padding:26px 18px 20px;text-align:center;position:relative;box-shadow:0 12px 40px rgba(0,0,0,.2);animation:modalAnim .25s ease-out}
    @keyframes modalAnim{0%{opacity:0;transform:scale(.9)}100%{opacity:1;transform:scale(1)}}
    .course-modal-close{position:absolute;top:10px;right:14px;border:none;background:none;font-size:20px;color:#aaa;cursor:pointer;padding:4px;line-height:1}
  </style>
</body>
</html>`;

  const filePath = path.join(PAGEFIRE_WORKS_DIR, artwork.id + '.html');
  fs.writeFileSync(filePath, html, 'utf-8');
}

// 压缩图片为 webp 并存入 PageFire 部署目录

function generateAllWorkPages() {
  artworks.forEach(a => {
    generateWorkPage(a);
    const pfImgPath = path.join(PAGEFIRE_ARTWORKS_DIR, a.id + '.webp');
    if (!fs.existsSync(pfImgPath)) compressForPagefire(a);
  });
}

function generatePagefireWorkPage(artwork) {
  const displayDate = artwork.date
    ? `${artwork.date.slice(0,4)}年${artwork.date.slice(4,6)}月${artwork.date.slice(6,8)}日`
    : '';
  const webpId = artwork.id;
  const safeName = artwork.name.replace(/"/g, '\"');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${safeName}的AI艺术作品 · 大象智绘AI科创</title>
  <meta property="og:title" content="${safeName}的敦煌AI艺术作品 | 大象智绘AI科创">
  <meta property="og:description" content="大象智绘AI科创 · 10年艺术教育经验×AI创新教育。我在广州美术馆用AI创作了一幅敦煌风格作品,快来看看吧！">
  <meta property="og:image" content="${PAGEFIRE_BASE_URL}/artworks/${webpId}.webp">
  <meta property="og:type" content="website">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:linear-gradient(180deg,#f8f4ee 0%,#efe8dc 100%);color:#4a3f30;min-height:100vh;display:flex;flex-direction:column;align-items:center;overflow-x:hidden}
    .page{width:100%;max-width:480px;display:flex;flex-direction:column;align-items:center;padding-bottom:50px}
    .brand-header{width:100%;padding:18px 20px 14px;display:flex;align-items:center;gap:14px;border-bottom:1px solid rgba(201,169,110,.2)}
    .brand-header .logo{flex-shrink:0}
    .brand-header .logo img{height:52px;width:auto;display:block}
    .brand-header .brand-text{flex:1;min-width:0}
    .brand-header .brand-name{font-size:17px;font-weight:700;color:#3d3020;letter-spacing:1px}
    .brand-header .brand-tagline{font-size:11px;color:#8a7a5e;margin-top:2px;letter-spacing:.5px}
    .hero{width:100%;position:relative;cursor:pointer}
    .hero a{display:block;position:relative}
    .hero img{width:100%;display:block}
    .hero-label{position:absolute;top:12px;left:12px;background:rgba(74,63,48,.65);color:#f0dda0;font-size:11px;padding:4px 10px;border-radius:12px;letter-spacing:2px;pointer-events:none;z-index:1;backdrop-filter:blur(4px)}
    .hero-tap-hint{position:absolute;bottom:14px;right:14px;background:rgba(74,63,48,.75);color:#f0dda0;font-size:12px;padding:6px 12px;border-radius:18px;pointer-events:none;z-index:1;animation:bounceY 1.5s ease-in-out infinite;display:flex;align-items:center;gap:5px;backdrop-filter:blur(4px)}
    @keyframes bounceY{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    .info{width:100%;padding:18px 20px 8px;text-align:center}
    .child-name{font-size:24px;font-weight:700;color:#3d3020}
    .child-name .sub{font-size:14px;font-weight:400;color:#8a7a5e}
    .date-badge{display:inline-block;font-size:12px;color:#8a7a5e;margin-top:6px;padding:2px 14px;border:1px solid #c9a96e;border-radius:20px}
    .save-tip{width:calc(100% - 40px);max-width:440px;margin:6px 20px 0;text-align:center;padding:8px 14px;background:rgba(201,169,110,.1);border-radius:10px;color:#7a6a52;font-size:12px;line-height:1.6}
    .brand-statement{width:calc(100% - 40px);max-width:440px;margin:18px 20px 0;padding:16px 18px;background:linear-gradient(135deg,rgba(74,63,48,.04),rgba(201,169,110,.08));border-radius:12px;text-align:center}
    .brand-statement .icon{font-size:22px;margin-bottom:6px}
    .brand-statement h4{font-size:14px;color:#3d3020;font-weight:600;margin-bottom:6px;letter-spacing:1px}
    .brand-statement p{font-size:12.5px;color:#7a6a52;line-height:1.8;letter-spacing:.3px}
    .course-cta{width:calc(100% - 40px);max-width:440px;margin:18px 20px 0;background:linear-gradient(135deg,#3d3020,#2a2218);border-radius:16px;padding:22px 18px 18px;text-align:center;box-shadow:0 6px 24px rgba(61,48,32,.18)}
    .course-cta .cta-badge{display:inline-block;font-size:11px;background:rgba(240,221,160,.15);color:#f0dda0;padding:3px 12px;border-radius:10px;letter-spacing:1px;margin-bottom:10px}
    .course-cta h3{font-size:18px;color:#f0dda0;font-weight:700;margin-bottom:6px;letter-spacing:1px}
    .course-cta .desc{font-size:13px;color:#c9a96e;line-height:1.7;margin-bottom:12px}
    .course-cta .features{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
    .course-cta .features span{font-size:11px;color:#c9a96e;background:rgba(201,169,110,.1);padding:4px 10px;border-radius:8px;border:1px solid rgba(201,169,110,.15)}
    .course-cta .price-row{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:16px}
    .course-cta .price-current{font-size:28px;font-weight:700;color:#f0dda0;letter-spacing:1px}
    .course-cta .price-original{font-size:14px;color:#8a7a5e;text-decoration:line-through}
    .course-cta .price-tag{font-size:11px;color:#c9a96e;background:rgba(201,169,110,.15);padding:2px 8px;border-radius:4px}
    .course-cta .cta-btn{display:block;padding:14px 0;background:linear-gradient(135deg,#c9a96e,#a08050);color:#1a1410;font-size:15px;font-weight:700;border:none;border-radius:22px;cursor:pointer;text-decoration:none;text-align:center;letter-spacing:1px;box-shadow:0 4px 12px rgba(201,169,110,.25)}
    .course-cta .cta-btn:active{opacity:.85;transform:scale(.97)}
    .course-cta .urgency{font-size:11px;color:#c9a96e;margin-top:10px;opacity:.8}
    .wechat-card{width:calc(100% - 40px);max-width:440px;margin:14px 20px 0;padding:18px;background:#fff;border:1px solid #e0d5c5;border-radius:14px;text-align:center;box-shadow:0 2px 8px rgba(74,63,48,.04)}
    .wechat-card h4{font-size:14px;color:#3d3020;font-weight:600;margin-bottom:4px}
    .wechat-card .sub{font-size:12px;color:#8a7a5e;margin-bottom:12px;line-height:1.5}
    .wechat-card .qrcode{display:flex;justify-content:center;margin-bottom:8px}
    .wechat-card .qrcode .qr-placeholder{width:120px;height:120px;background:#f8f4ee;border:2px dashed #d4c5aa;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a8946c;font-size:11px;gap:4px;line-height:1.4}
    .wechat-card .social-proof{font-size:11px;color:#a8946c;margin-top:4px}
    .pipeline{width:calc(100% - 40px);max-width:440px;margin:14px 20px 0;padding:18px 16px;background:rgba(201,169,110,.05);border:1px solid #e0d5c5;border-radius:14px;text-align:center}
    .pipeline h4{font-size:13px;color:#3d3020;font-weight:600;margin-bottom:12px;letter-spacing:1px}
    .pipeline-steps{display:flex;flex-direction:column;gap:8px}
    .pipeline .step{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:#5a4f3a}
    .pipeline .step .arrow{color:#c9a96e;font-size:14px}
    .footer{text-align:center;padding:24px 20px 16px;border-top:1px solid #e0d5c5;width:100%;margin-top:auto}
    .footer .brand{font-size:14px;color:#8a7a5e;letter-spacing:3px;font-weight:600}
    .footer .sub{font-size:11px;color:#a8946c;margin-top:4px}
    .footer .contact{font-size:11px;color:#b5a88a;margin-top:6px}
  </style>
</head>
<body>
  <div class="page">
    <div class="brand-header">
      <div class="logo">
        <img src="../logo.png" alt="大象智绘AI科创">
      </div>
      <div class="brand-text">
        <div class="brand-name">大象智绘AI科创</div>
        <div class="brand-tagline">10年艺术教育经验 · AI创新教育引领者</div>
      </div>
    </div>
    <div class="hero">
      <div class="hero-label">AI 共创</div>
      <a href="${PAGEFIRE_BASE_URL}/artworks/${webpId}.webp" id="img-link">
        <img src="../artworks/${webpId}.webp" alt="${safeName}的作品" />
        <div class="hero-tap-hint">👆 长按保存图片</div>
      </a>
    </div>
    <div class="info">
      <div class="child-name">${safeName}<span class="sub">的AI艺术作品</span></div>
      
    </div>
    <div class="save-tip" id="save-tip">👆 长按上方作品图片 → 选择「保存图片」即可存到手机相册</div>
    <div class="brand-statement">
      <div class="icon">🤖</div>
      <h4>这就是AI+艺术的魔法</h4>
      <p>大象智绘AI科创,深耕艺术教育十余年,融合AI前沿技术,<br>让孩子用想象力触碰未来。这里展出的每一幅作品,<br>都是孩子创意与AI智能的共同杰作。</p>
    </div>
    <div class="course-cta">
      <div class="cta-badge">🔥 热门体验 · 二楼专享</div>
      <h3>🎬 AI微电影创作体验课</h3>
      <p class="desc">用你刚刚创作的敦煌角色,30分钟变身动画短片主角！<br>专业老师全程指导,零基础也能完成大片</p>
      <div class="features">
        <span>✨ AI角色生成</span>
        <span>🎨 场景创作</span>
        <span>📽️ 15秒大片</span>
      </div>
      <div class="price-row">
        <span class="price-current">¥125</span>
        <span class="price-original">¥198</span>
        <span class="price-tag">今日专享</span>
      </div>
      <a class="cta-btn" href="javascript:;" onclick="showCourseModal()">🎯 立即报名二楼课程</a>
      <div class="urgency">⏰ 每场仅限12人 · 请到二楼咨询现场老师</div>
    </div>
    <div class="wechat-card">
      <h4>📱 加微信 · 领高清作品图</h4>
      <p class="sub">扫码添加,在线发送作品高清原图<br>获取更多AI课程资讯与专属福利</p>
      <div class="qrcode">
        <div class="qr-placeholder">
          <span style="font-size:28px">📲</span>
          <span>扫码加微信</span>
          <span style="font-size:10px">请替换为实际二维码</span>
        </div>
      </div>
      <p class="social-proof">已有 200+ 家长在微信社群交流AI艺术创作心得 💬</p>
    </div>
    <div class="pipeline">
      <h4>🎯 大象智绘 · 课程体系</h4>
      <div class="pipeline-steps">
        <div class="step"><span>🆓</span><span>一楼·免费AI体验</span><span class="arrow">▸</span></div>
        <div class="step"><span>🎬</span><span>二楼·¥125 AI微电影课</span><span class="arrow">▸</span></div>
        <div class="step"><span>📚</span><span>暑假班/秋季班·系统学习AI创作</span></div>
      </div>
    </div>
    <div class="footer">
      <div class="brand">大象智绘AI科创中心</div>
      <div class="sub">10年专注 · AI赋能艺术教育</div>
      <div class="contact">📍 广州美术馆二楼研学区 · 现场咨询请联系工作人员</div>
    </div>
  </div>
  <script>
  (function(){
    var ua = navigator.userAgent.toLowerCase();
    var isWechat = ua.indexOf('micromessenger') > -1;
    var tip = document.getElementById('save-tip');
    if (isWechat) {
      tip.innerHTML = '👆 长按上方作品图片 → 选择「保存图片」即可存到手机相册';
    } else {
      tip.innerHTML = '👆 长按上方作品图片 → 选择「保存到相册」即可存到手机';
    }
  })();
  </script>
  <!-- Course enrollment modal -->
  <div id="courseModal" class="course-modal-overlay" style="display:none" onclick="hideCourseModal()">
    <div class="course-modal-box" onclick="event.stopPropagation()">
      <button class="course-modal-close" onclick="hideCourseModal()">✕</button>
      <div style="font-size:40px;margin-bottom:8px">🎬</div>
      <h3 style="font-size:18px;color:#3d3020;margin-bottom:4px">二楼·AI微电影课</h3>
      <p style="font-size:13px;color:#7a6a52;margin-bottom:12px;line-height:1.6">30分钟,让孩子刚才创作的角色<br>变成动画短片主角！</p>
      <div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">✨ AI角色生成</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">🎨 场景创作</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">📽️ 15秒大片</span>
      </div>
      <div style="margin-bottom:14px">
        <strong style="font-size:26px;color:#3d3020">¥125</strong>
        <s style="font-size:14px;color:#aaa;margin-left:8px">原价¥198</s>
      </div>
      <div style="margin-bottom:10px">
        <div style="width:120px;height:120px;background:#f8f4ee;border:2px dashed #d4c5aa;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a8946c;font-size:11px;gap:4px;margin:0 auto">
          <span style="font-size:26px">📲</span>
          <span>扫码加微信</span>
          <span style="font-size:10px">替换实际二维码</span>
        </div>
      </div>
      <p style="font-size:11px;color:#a8946c">发送作品编号,优先预留名额</p>
    </div>
  </div>
  <style>
    .course-modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
    .course-modal-box{background:linear-gradient(135deg,#fff,#faf6ef);max-width:340px;width:88%;border-radius:20px;padding:26px 18px 20px;text-align:center;position:relative;box-shadow:0 12px 40px rgba(0,0,0,.2);animation:modalAnim .25s ease-out}
    @keyframes modalAnim{0%{opacity:0;transform:scale(.9)}100%{opacity:1;transform:scale(1)}}
    .course-modal-close{position:absolute;top:10px;right:14px;border:none;background:none;font-size:20px;color:#aaa;cursor:pointer;padding:4px;line-height:1}
  </style>
</body>
</html>`;

  const filePath = path.join(PAGEFIRE_WORKS_DIR, artwork.id + '.html');
  fs.writeFileSync(filePath, html, 'utf-8');
}

// 压缩图片为 webp 并存入 PageFire 部署目录



function compressForPagefire(artwork) {
  try {
    const srcPath = path.join(ARTWORKS_DIR, artwork.filename);
    const dstPath = path.join(PAGEFIRE_ARTWORKS_DIR, artwork.id + '.webp');
    if (!fs.existsSync(srcPath)) return;
    // 使用简单的文件复制(如果有 sharp 可以压缩,否则直接复制)
    // PageFire 对图片大小不敏感,直接复制原图
    fs.copyFileSync(srcPath, dstPath);
  } catch (e) {
    console.error('PageFire 图片同步失败:', e.message);
  }
}

// 延迟部署 PageFire(防重复触发,15秒内多次调用只部署一次)
let pagefireDeployTimer = null;
function schedulePagefireDeploy() {
  if (pagefireDeployTimer) clearTimeout(pagefireDeployTimer);
  pagefireDeployTimer = setTimeout(() => {
    console.log('自动部署 PageFire...');
    exec('npx pagefire deploy --dir deploy-pagefire', { cwd: __dirname }, (err, stdout, stderr) => {
      if (err) console.error('PageFire 部署失败:', err.message);
      else console.log('PageFire 部署完成:', stdout.slice(0, 200));
    });
  }, 15000);
}

// ===== API: 作品管理 =====

// 获取所有作品(展示页只返回在架的)
app.get('/api/artworks', (req, res) => {
  res.json(artworks.filter(a => a.status === 'active'));
});

// 获取全部作品(管理后台,含已归档)
app.get('/api/artworks/all', (req, res) => {
  res.json(artworks);
});

// 统计
app.get('/api/artworks/stats', (req, res) => {
  const active = artworks.filter(a => a.status === 'active').length;
  const archived = artworks.filter(a => a.status === 'archived').length;
  res.json({ total: artworks.length, active, archived });
});

// 今日引流看板
app.get('/api/analytics/today', (req, res) => {
  const today = ensureToday();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}${String(yesterday.getMonth()+1).padStart(2,'0')}${String(yesterday.getDate()).padStart(2,'0')}`;
  const yest = analytics[yKey] || { pageViews: 0, visitors: [], newArtworks: 0, displayViews: 0, shareClicks: 0 };

  res.json({
    today: {
      pageViews: today.pageViews,
      uniqueVisitors: today.visitors.length,
      newArtworks: today.newArtworks,
      displayViews: today.displayViews,
      shareClicks: today.shareClicks
    },
    yesterday: {
      pageViews: yest.pageViews,
      uniqueVisitors: yest.visitors.length,
      newArtworks: yest.newArtworks,
      displayViews: yest.displayViews,
      shareClicks: yest.shareClicks
    }
  });
});

// ===== 数据看板 API =====
// 获取全部数据看板记录(含作品统计)
app.get('/api/dashboard', (req, res) => {
  const records = Object.entries(dashboardData).map(([date, data]) => ({
    date,
    ...data
  })).sort((a, b) => b.date.localeCompare(a.date)); // 最新在前

  res.json({ records });
});

// 获取/保存今日看板数据
app.get('/api/dashboard/today', (req, res) => {
  const key = todayKey();
  const data = dashboardData[key] || {
    experienceVisitors: 0,
    groupJoins: 0,
    wechatAdds: 0,
    courseSignups: 0,
    notes: ''
  };
  res.json({ date: key, ...data });
});

app.post('/api/dashboard/today', express.json(), (req, res) => {
  const key = todayKey();
  const { experienceVisitors, groupJoins, wechatAdds, courseSignups, notes } = req.body;
  if (!dashboardData[key]) dashboardData[key] = {};
  if (experienceVisitors !== undefined) dashboardData[key].experienceVisitors = Number(experienceVisitors) || 0;
  if (groupJoins !== undefined) dashboardData[key].groupJoins = Number(groupJoins) || 0;
  if (wechatAdds !== undefined) dashboardData[key].wechatAdds = Number(wechatAdds) || 0;
  if (courseSignups !== undefined) dashboardData[key].courseSignups = Number(courseSignups) || 0;
  if (notes !== undefined) dashboardData[key].notes = String(notes);
  dashboardData[key].updatedAt = Date.now();
  saveData(DASHBOARD_FILE, dashboardData);
  res.json({ success: true, data: dashboardData[key] });
});

// 上传作品
// ===== 追踪API =====
app.post('/api/track/cta-click', express.json(), (req, res) => {
  const { artworkId } = req.body || {};
  trackCtaClick(artworkId || 'unknown');
  res.json({ success: true });
});

app.post('/api/artworks/upload', uploadArtwork.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });

  const { name, date } = req.body;
  const artwork = {
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    name: name || '匿名小画家',
    date: date || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    filename: req.file.filename,
    url: `/uploads/artworks/${req.file.filename}`,
    status: 'active',
    createdAt: Date.now()
  };

  artworks.push(artwork);
  saveData(ARTWORKS_FILE, artworks);
  trackNewArtwork(1);
  generateWorkPage(artwork);
  compressForPagefire(artwork);
  schedulePagefireDeploy(); // 自动部署到公网

  // 实时推送到展示页
  io.emit('artwork:new', artwork);

  res.json({ success: true, artwork });
});

// 下架作品(归档,不移除数据)
app.put('/api/artworks/:id/archive', (req, res) => {
  const { id } = req.params;
  const artwork = artworks.find(a => a.id === id);
  if (!artwork) return res.status(404).json({ error: '作品不存在' });

  artwork.status = 'archived';
  artwork.archivedAt = Date.now();
  saveData(ARTWORKS_FILE, artworks);

  // 添加到归档记录(永久保留)
  const existing = archive.find(a => a.id === id);
  if (!existing) {
    archive.push({ ...artwork });
    saveData(ARCHIVE_FILE, archive);
  }

  io.emit('artwork:archive', { id });
  res.json({ success: true, artwork });
});

// 重新上架
app.put('/api/artworks/:id/restore', (req, res) => {
  const { id } = req.params;
  const artwork = artworks.find(a => a.id === id);
  if (!artwork) return res.status(404).json({ error: '作品不存在' });

  artwork.status = 'active';
  delete artwork.archivedAt;
  saveData(ARTWORKS_FILE, artworks);

  // 从归档记录中移除
  archive = archive.filter(a => a.id !== id);
  saveData(ARCHIVE_FILE, archive);

  io.emit('artwork:restore', { id, artwork });
  res.json({ success: true, artwork });
});

// 彻底删除(从所有记录中清除,包括文件)
app.delete('/api/artworks/:id/purge', (req, res) => {
  const { id } = req.params;
  const idx = artworks.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: '作品不存在' });

  const artwork = artworks[idx];
  const filePath = path.join(ARTWORKS_DIR, artwork.filename);

  artworks.splice(idx, 1);
  saveData(ARTWORKS_FILE, artworks);

  // 从归档中移除
  archive = archive.filter(a => a.id !== id);
  saveData(ARCHIVE_FILE, archive);

  // 删除静态作品页
  const workPagePath = path.join(WORKS_DIR, id + '.html');
  if (fs.existsSync(workPagePath)) fs.unlinkSync(workPagePath);
  // 删除 PageFire 版本
  const pfWorkPath = path.join(PAGEFIRE_WORKS_DIR, id + '.html');
  const pfImgPath = path.join(PAGEFIRE_ARTWORKS_DIR, id + '.webp');
  try { if (fs.existsSync(pfWorkPath)) fs.unlinkSync(pfWorkPath); } catch(e) {}
  try { if (fs.existsSync(pfImgPath)) fs.unlinkSync(pfImgPath); } catch(e) {}

  // 删除原文件
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { console.error('删除文件失败:', e); }
  }

  io.emit('artwork:purge', { id });
  res.json({ success: true });
});

// 批量上传
app.post('/api/artworks/batch', uploadArtwork.array('images', 50), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请选择图片' });

  const { names, dates } = req.body;
  const nameList = names ? JSON.parse(names) : [];
  const dateList = dates ? JSON.parse(dates) : [];
  const newArtworks = [];

  req.files.forEach((file, i) => {
    const id = path.basename(file.filename, path.extname(file.filename));
    const artwork = {
      id,
      name: nameList[i] || '匿名小画家',
      date: dateList[i] || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      filename: file.filename,
      url: `/uploads/artworks/${file.filename}`,
      status: 'active',
      createdAt: Date.now()
    };
    artworks.push(artwork);
    newArtworks.push(artwork);
    generateWorkPage(artwork);
    compressForPagefire(artwork);
  });

  saveData(ARTWORKS_FILE, artworks);
  trackNewArtwork(newArtworks.length);
  schedulePagefireDeploy(); // 自动部署到公网
  io.emit('artworks:batch', newArtworks);

  res.json({ success: true, count: newArtworks.length, artworks: newArtworks });
});

// ===== API: 背景图管理 =====

// 获取背景配置
app.get('/api/background', (req, res) => {
  res.json(bgConfig);
});

// 上传背景图
app.post('/api/background/upload', uploadBg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });

  // 删除旧背景
  if (bgConfig.filename && bgConfig.filename !== req.file.filename) {
    const oldPath = path.join(BG_DIR, bgConfig.filename);
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (e) {}
    }
  }

  bgConfig.filename = req.file.filename;
  bgConfig.url = `/uploads/background/${req.file.filename}`;
  saveData(BG_FILE, bgConfig);

  io.emit('background:update', bgConfig);

  res.json({ success: true, background: bgConfig });
});

// 更新背景设置(位置/缩放)
app.put('/api/background', express.json(), (req, res) => {
  const { position, scale } = req.body;
  if (position) bgConfig.position = position;
  if (scale) bgConfig.scale = scale;
  saveData(BG_FILE, bgConfig);

  io.emit('background:update', bgConfig);

  res.json({ success: true, background: bgConfig });
});

// ===== API: 视频管理 =====

// 获取视频列表
app.get('/api/videos', (req, res) => {
  res.json(videos);
});

// 获取视频播放配置
app.get('/api/videos/config', (req, res) => {
  res.json({
    interval: videoConfig.interval,
    repeat: videoConfig.repeat,
    enabled: videos.length > 0
  });
});

// 上传视频
app.post('/api/videos/upload', uploadVideo.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择视频' });

  const { name, date } = req.body;
  const video = {
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    name: name || '精彩回顾',
    date: date || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    filename: req.file.filename,
    url: `/uploads/videos/${req.file.filename}`,
    createdAt: Date.now()
  };

  videos.push(video);
  saveData(VIDEOS_FILE, videos);
  io.emit('videos:update', videos);

  res.json({ success: true, video });
});

// 删除视频
app.delete('/api/videos/:id', (req, res) => {
  const { id } = req.params;
  const idx = videos.findIndex(v => v.id === id);
  if (idx === -1) return res.status(404).json({ error: '视频不存在' });

  const video = videos[idx];
  const filePath = path.join(VIDEOS_DIR, video.filename);

  videos.splice(idx, 1);
  saveData(VIDEOS_FILE, videos);
  io.emit('videos:update', videos);

  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { console.error('删除视频文件失败:', e); }
  }

  res.json({ success: true });
});

// 更新视频播放配置
app.put('/api/videos/config', express.json(), (req, res) => {
  videoConfig.interval = req.body.interval || 300;
  videoConfig.repeat = req.body.repeat || 2;
  saveData(VIDEOS_CONFIG_FILE, videoConfig);

  const cfg = {
    interval: videoConfig.interval,
    repeat: videoConfig.repeat,
    enabled: videos.length > 0
  };
  io.emit('videos:config', cfg);
  res.json({ success: true, config: cfg });
});
// 重新生成所有作品页 + 部署 PageFire
app.post('/api/regenerate-pages', (req, res) => {
  generateAllWorkPages();
  schedulePagefireDeploy();
  res.json({ success: true, message: '所有作品页已重新生成,PageFire 部署将在15秒内开始' });
});

io.on('connection', (socket) => {
  console.log(`客户端已连接: ${socket.id}`);
  // 展示页只推送在架作品,管理页用 /api/artworks/all 获取全部
  socket.emit('sync', { artworks: artworks.filter(a => a.status === 'active'), background: bgConfig, videos });

  // 追踪展示页浏览
  socket.on('display:connected', () => { trackDisplayView(); });

  socket.on('disconnect', () => console.log(`客户端断开: ${socket.id}`));
});

// ===== 全局错误处理(必须在所有路由之后)=====
app.use(multerErrorHandler);

// ===== 启动 =====
// 生成所有已有作品的静态页
generateAllWorkPages();

server.listen(PORT, () => {
  // 自动获取局域网 IP
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let lanIP = 'localhost';
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        lanIP = addr.address;
        break;
      }
    }
    if (lanIP !== 'localhost') break;
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     敦煌AIGC艺术展览 · 投屏展示系统已启动      ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║  展示页(电视大屏):                              ║`);
  console.log(`║    http://localhost:${PORT}/display              ║`);
  console.log(`║  管理页(后台操作):                              ║`);
  console.log(`║    http://localhost:${PORT}/admin                ║`);
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║  手机端作品页(同WiFi扫码访问):                  ║`);
  console.log(`║    http://${lanIP}:${PORT}/work/{作品ID}       `.padEnd(51) + '║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
});




