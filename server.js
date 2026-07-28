const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const sharp = require('sharp');
const FormData = require('form-data');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// ===== Rembg 鑷姩鎶犲浘閰嶇疆 =====
const REMBG_HOST = 'localhost';
const REMBG_PORT = 7000;
const REMBG_TIMEOUT = 15000;

// ===== 鐩綍鍑嗗 =====
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const ARTWORKS_DIR = path.join(UPLOADS_DIR, 'artworks');
const ORIGINALS_DIR = path.join(UPLOADS_DIR, 'originals');
const BG_DIR = path.join(UPLOADS_DIR, 'background');
const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
const WORKS_DIR = path.join(__dirname, 'public', 'works');
const DATA_DIR = path.join(__dirname, 'data');

// PageFire 鍏綉閮ㄧ讲鐩綍
const PAGEFIRE_DIR = path.join(__dirname, 'deploy-pagefire');
const PAGEFIRE_WORKS_DIR = path.join(PAGEFIRE_DIR, 'works');
const PAGEFIRE_ARTWORKS_DIR = path.join(PAGEFIRE_DIR, 'artworks');
const PAGEFIRE_BASE_URL = 'https://17xskjdaxiang-daxiang.pagefire.openhkt.com';

[UPLOADS_DIR, ARTWORKS_DIR, ORIGINALS_DIR, BG_DIR, VIDEOS_DIR, WORKS_DIR, DATA_DIR, PAGEFIRE_DIR, PAGEFIRE_WORKS_DIR, PAGEFIRE_ARTWORKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ===== 鏁版嵁鏂囦欢 =====
const ARTWORKS_FILE = path.join(DATA_DIR, 'artworks.json');
const BG_FILE = path.join(DATA_DIR, 'background.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const VIDEOS_CONFIG_FILE = path.join(DATA_DIR, 'videos_config.json');

function loadData(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('璇诲彇鏁版嵁澶辫触:', e); }
  return fallback;
}

function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let artworks = loadData(ARTWORKS_FILE, []);
let bgConfig = loadData(BG_FILE, { filename: null, position: 'center', scale: 'cover' });
let videos = loadData(VIDEOS_FILE, []);
let videoConfig = loadData(VIDEOS_CONFIG_FILE, { interval: 300, repeat: 2 });

// ===== 璁块棶缁熻 / 寮曟祦鐪嬫澘 =====
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
let analytics = loadData(ANALYTICS_FILE, {});

// ===== 鏁版嵁鐪嬫澘(鎵嬪姩濉啓) =====
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

// IP 鑾峰彇
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// 鍚戝悗鍏煎:鎵€鏈夊凡鏈変綔鍝佹病鏈?status 鐨勯粯璁よ涓?active
artworks = artworks.map(a => ({ ...a, status: a.status || 'active' }));
if (artworks.some(a => !a.status)) saveData(ARTWORKS_FILE, artworks);

// 褰掓。璁板綍鏂囦欢(姘镐箙淇濈暀,姘镐笉鍒犻櫎)
const ARCHIVE_FILE = path.join(DATA_DIR, 'artworks_archive.json');
let archive = loadData(ARCHIVE_FILE, []);

// ===== Multer 閰嶇疆 =====
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
  cb(allowed.includes(ext) ? null : new Error('浠呮敮鎸佽棰戞枃浠?(mp4/webm/avi/mov/mkv)'), allowed.includes(ext));
};

const uploadVideo = multer({ storage: videoStorage, fileFilter: videoFilter, limits: { fileSize: 500 * 1024 * 1024 } });

const uploadArtwork = multer({ storage: artworkStorage, fileFilter: imageFilter, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadBg = multer({ storage: bgStorage, fileFilter: imageFilter, limits: { fileSize: 30 * 1024 * 1024 } });

// ===== Multer 閿欒澶勭悊涓棿浠?=====
function multerErrorHandler(err, req, res, next) {
  if (err) {
    console.error('涓婁紶閿欒:', err.message);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件太大,请上传20MB以内的图片' });
    }
    return res.status(400).json({ error: err.message || '涓婁紶澶辫触' });
  }
  next();
}

// ===== 椤甸潰璺敱 =====
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/', (req, res) => res.redirect('/admin'));

// ===== 鎵嬫満绔綔鍝佸睍绀洪〉 =====
app.get('/work/:id', (req, res) => {
  const artwork = artworks.find(a => a.id === req.params.id);
  if (!artwork) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>浣滃搧鏈壘鍒?/title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#999;font-size:18px;}</style>
      </head><body>浣滃搧鏈壘鍒版垨宸蹭笅鏋?/body></html>
    `);
  }
  trackPageView(getClientIP(req));

  const displayDate = artwork.date
    ? `${artwork.date.slice(0,4)}骞?{artwork.date.slice(4,6)}鏈?{artwork.date.slice(6,8)}鏃
    : '';

  res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${artwork.name} 鐨勪綔鍝?路 鏁︾厡AIGC鑹烘湳灞?/title>
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
      <div class="hero-label">AI 鍏卞垱</div>
      <img src="${artwork.url}" alt="${artwork.name} 鐨勪綔鍝? />
    </div>
    <div class="info">
      <div class="child-name">${artwork.name}<span class="sub"> 鐨凙I鑹烘湳浣滃搧</span></div>
      ${displayDate ? `<div class="date-badge">${displayDate}</div>` : ''}
    </div>
    <button class="save-btn" onclick="saveImage()">淇濆瓨浣滃搧鍥剧墖</button>
    <div class="footer">
      <div class="brand">鏁︾厡 路 AIGC 鑹烘湳灞?/div>
      <div class="sub">澶ц薄鏅虹粯 AI 绉戝垱</div>
      <div class="cta">鎵爜璁╁瀛愪綋楠孉I鑹烘湳鍒涗綔</div>
    </div>
  </div>
  <script>
    function saveImage() {
      const link = document.createElement('a');
      link.download = '${artwork.name}_AI浣滃搧.png';
      link.href = '${artwork.url}';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  </script>
    <div class="footer">
      <div class="brand">????</div>
      <div class="sub">� 2026 ????AI?? � ????AI+???????</div>
    </div>
  </body>
</html>
  `);
});

// ===== ?????????????? =====
app.get('/works/:filename', (req, res, next) => {
  if (req.params.filename.endsWith('.html')) {
    trackPageView(getClientIP(req));
  }
  next(); // 缁х画浜ょ粰 static 涓棿浠?
});

// ===== 闈欐€佹枃浠?=====
app.use(express.static(path.join(__dirname, 'public')));

// ===== 闈欐€佷綔鍝侀〉鐢熸垚 =====
function generateWorkPage(artwork) {
  const displayDate = artwork.date
    ? `${artwork.date.slice(0,4)}骞?{artwork.date.slice(4,6)}鏈?{artwork.date.slice(6,8)}鏃
    : '';
  const safeName = artwork.name.replace(/"/g, '\"');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title> 路 AI鑹烘湳浣滃搧 路 澶ц薄鏅虹粯AI绉戝垱</title>
  <meta property="og:title" content="鐨勬暒鐓孉I鑹烘湳浣滃搧 | 澶ц薄鏅虹粯AI绉戝垱">
  <meta property="og:description" content="澶ц薄鏅虹粯AI绉戝垱路20骞磋壓鏈暀鑲茬粡楠屆桝I鍒涙柊鏁欒偛銆傛垜鍦ㄥ箍宸炵編鏈鐢ˋI鍒涗綔浜嗕竴骞呮暒鐓岄鏍间綔鍝?蹇潵鐪嬬湅鍚э紒">
  <meta property="og:image" content="../artworks/.png">
  <meta property="og:type" content="website">
  <style>
    /* ===== Reset & Base ===== */
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    :root{
      --gold:#c9a96e;
      --gold-light:#f0dda0;
      --brown:#3d3020;
      --brown-light:#8a7a5e;
      --cream:#f8f4ee;
      --cream-dark:#efe8dc;
      --purple:#a855f7;
      --purple-dark:#7c3aed;
      --card-radius:16px;
      --ease-out-expo:cubic-bezier(0.16,1,0.3,1);
      --ease-spring:cubic-bezier(0.34,1.56,0.64,1);
    }
    html{scroll-behavior:smooth}
    body{
      font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
      background:var(--cream);
      color:var(--brown);
      min-height:100vh;
      display:flex;
      flex-direction:column;
      align-items:center;
      overflow-x:hidden;
      -webkit-font-smoothing:antialiased;
    }

    /* ===== Reading Progress Bar ===== */
    #progress-bar{
      position:fixed;top:0;left:0;height:3px;
      background:linear-gradient(90deg,var(--gold),var(--purple));
      z-index:9999;
      width:0%;
      transition:width 0.1s linear;
      box-shadow:0 0 8px rgba(168,85,247,0.3);
    }

    /* ===== Page Container ===== */
    .page{
      width:100%;max-width:480px;
      display:flex;flex-direction:column;align-items:center;
      padding-bottom:60px;
      position:relative;
    }

    /* ===== Scroll Reveal ===== */
    .reveal{
      opacity:0;transform:translateY(30px);
      transition:opacity 0.8s var(--ease-out-expo), transform 0.8s var(--ease-out-expo);
    }
    .reveal.visible{opacity:1;transform:translateY(0)}
    .reveal-delay-1{transition-delay:0.1s}
    .reveal-delay-2{transition-delay:0.2s}
    .reveal-delay-3{transition-delay:0.3s}
    .reveal-delay-4{transition-delay:0.4s}
    .reveal-delay-5{transition-delay:0.5s}

    /* ===== Hero Entrance ===== */
    .hero-entrance{
      animation:heroZoom 1.2s var(--ease-out-expo) forwards;
      opacity:0;
    }
    @keyframes heroZoom{
      0%{opacity:0;transform:scale(0.92);filter:blur(4px)}
      100%{opacity:1;transform:scale(1);filter:blur(0)}
    }

    /* ===== Brand Header ===== */
    .brand-header{
      width:100%;padding:18px 20px 14px;
      display:flex;align-items:center;gap:14px;
      border-bottom:1px solid rgba(201,169,110,.15);
      background:rgba(248,244,238,.85);
      backdrop-filter:blur(12px);
      -webkit-backdrop-filter:blur(12px);
      position:sticky;top:3px;z-index:100;
    }
    .brand-header .logo-wrap{
      width:auto;height:48px;
      flex-shrink:0;
      display:flex;align-items:center;
    }
    .brand-header .logo-wrap img{height:48px;width:auto;display:block}
    .brand-header .brand-name{
      font-size:16px;font-weight:700;color:var(--brown);
      letter-spacing:1px;line-height:1.2;
    }
    .brand-header .brand-tagline{
      font-size:10.5px;color:var(--brown-light);
      margin-top:1px;letter-spacing:.3px;
    }

    /* ===== Share Action ===== */
    .share-bar{
      display:flex;align-items:center;gap:8px;
      padding:6px 20px 10px;
      width:100%;
    }
    .share-bar .share-hint{
      font-size:11px;color:var(--brown-light);flex:1;
    }
    .share-btn{
      width:36px;height:36px;
      border-radius:50%;
      border:none;
      background:rgba(201,169,110,.15);
      color:var(--brown);
      font-size:16px;
      cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      transition:all .25s ease;
    }
    .share-btn:active{transform:scale(.9);background:rgba(201,169,110,.3)}

    /* ===== Hero Image ===== */
    .hero{
      width:100%;padding:8px 16px 0;
    }
    .hero-inner{
      position:relative;
      border-radius:var(--card-radius);
      overflow:hidden;
      box-shadow:0 8px 32px rgba(74,63,48,.08), 0 2px 8px rgba(74,63,48,.04);
      cursor:pointer;
    }
    .hero-inner img{width:100%;display:block;transition:transform .4s ease}
    .hero-inner:active img{transform:scale(1.02)}
    .hero-badge{
      position:absolute;top:12px;left:12px;
      background:rgba(74,63,48,.65);
      color:var(--gold-light);
      font-size:11px;padding:4px 12px;
      border-radius:12px;
      letter-spacing:2px;
      backdrop-filter:blur(4px);
      -webkit-backdrop-filter:blur(4px);
      z-index:2;
    }
    .hero-tap-hint{
      position:absolute;bottom:14px;right:14px;
      background:rgba(74,63,48,.72);
      color:var(--gold-light);
      font-size:12px;padding:6px 14px;
      border-radius:18px;
      pointer-events:none;z-index:2;
      animation:bounceY 2s ease-in-out infinite;
      display:flex;align-items:center;gap:5px;
      backdrop-filter:blur(4px);
      -webkit-backdrop-filter:blur(4px);
    }
    @keyframes bounceY{
      0%,100%{transform:translateY(0)}
      50%{transform:translateY(-6px)}
    }

    /* ===== Lightbox ===== */
    .lightbox{
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,.85);
      backdrop-filter:blur(20px);
      -webkit-backdrop-filter:blur(20px);
      z-index:9998;
      display:flex;align-items:center;justify-content:center;
      opacity:0;pointer-events:none;
      transition:opacity .35s ease;
    }
    .lightbox.active{opacity:1;pointer-events:auto}
    .lightbox img{
      max-width:92%;max-height:88%;
      border-radius:12px;
      box-shadow:0 20px 60px rgba(0,0,0,.5);
      transform:scale(0.9);
      transition:transform .4s var(--ease-out-expo);
    }
    .lightbox.active img{transform:scale(1)}
    .lightbox-close{
      position:absolute;top:16px;right:16px;
      width:40px;height:40px;
      border-radius:50%;
      background:rgba(255,255,255,.1);
      border:none;
      color:#fff;
      font-size:22px;
      cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(4px);
    }
    .lightbox-save{
      position:absolute;bottom:40px;
      padding:12px 32px;
      background:linear-gradient(135deg,var(--gold),#a08050);
      color:var(--brown);
      font-size:15px;font-weight:600;
      border:none;border-radius:24px;
      cursor:pointer;
      letter-spacing:1px;
      box-shadow:0 4px 16px rgba(201,169,110,.3);
    }
    .lightbox-save:active{transform:scale(.95)}

    /* ===== Info Section ===== */
    .info{
      width:100%;padding:14px 20px 4px;
      text-align:center;
    }
    .child-name{
      font-size:24px;font-weight:700;color:var(--brown);
      line-height:1.3;
    }
    .child-name .sub{
      font-size:14px;font-weight:400;color:var(--brown-light);
    }
    .date-badge{
      display:inline-block;
      font-size:12px;color:var(--brown-light);
      margin-top:6px;
      padding:3px 14px;
      border:1px solid rgba(201,169,110,.4);
      border-radius:20px;
      background:rgba(201,169,110,.06);
    }

    /* ===== Tags ===== */
    .tech-tags{
      width:calc(100% - 40px);max-width:440px;
      margin:14px 20px 0;
      display:flex;justify-content:center;gap:8px;flex-wrap:wrap;
    }
    .tech-tags .tag{
      padding:5px 14px;border-radius:14px;
      font-size:11px;font-weight:500;
      display:flex;align-items:center;gap:4px;
      transition:transform .2s ease;
    }
    .tech-tags .tag:active{transform:scale(.95)}
    .tech-tags .tag.purple{
      background:rgba(168,85,247,.08);
      color:var(--purple);
      border:1px solid rgba(168,85,247,.15);
    }
    .tech-tags .tag.gold{
      background:rgba(201,169,110,.08);
      color:var(--brown-light);
      border:1px solid rgba(201,169,110,.15);
    }
    .tech-tags .tag.green{
      background:rgba(34,197,94,.08);
      color:#16a34a;
      border:1px solid rgba(34,197,94,.15);
    }

    /* ===== Section Divider ===== */
    .section-divider{
      width:calc(100% - 60px);max-width:400px;
      margin:20px auto 0;
      display:flex;align-items:center;gap:12px;
    }
    .section-divider .line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(201,169,110,.3),transparent)}
    .section-divider .dot{color:var(--gold);font-size:8px;opacity:.6}

    /* ===== Brand Story (Glass Card) ===== */
    .brand-story{
      width:calc(100% - 40px);max-width:440px;
      margin:16px 20px 0;
      padding:20px 18px;
      background:rgba(255,255,255,.6);
      backdrop-filter:blur(16px);
      -webkit-backdrop-filter:blur(16px);
      border:1px solid rgba(255,255,255,.8);
      border-radius:var(--card-radius);
      text-align:center;
      box-shadow:0 4px 20px rgba(74,63,48,.04);
    }
    .brand-story .icon{font-size:26px;margin-bottom:8px;display:block}
    .brand-story h4{
      font-size:14px;color:var(--brown);
      font-weight:700;margin-bottom:8px;
      letter-spacing:1px;
    }
    .brand-story p{
      font-size:12.5px;color:#6a5a4a;
      line-height:1.9;letter-spacing:.3px;
    }
    .brand-story p em{
      font-style:normal;
      background:linear-gradient(135deg,var(--purple),#6b5ce7);
      -webkit-background-clip:text;
      -webkit-text-fill-color:transparent;
      background-clip:text;
      font-weight:600;
    }

    /* ===== AI Reveal Card ===== */
    .ai-reveal{
      width:calc(100% - 40px);max-width:440px;
      margin:14px 20px 0;
      padding:18px 18px 16px;
      background:linear-gradient(135deg,rgba(168,85,247,.04),rgba(107,92,231,.04));
      border:1.5px dashed rgba(168,85,247,.25);
      border-radius:var(--card-radius);
      text-align:center;
    }
    .ai-reveal .icon{font-size:20px;margin-bottom:6px}
    .ai-reveal .title{
      font-size:13px;font-weight:700;
      background:linear-gradient(135deg,var(--purple),#6b5ce7);
      -webkit-background-clip:text;
      -webkit-text-fill-color:transparent;
      background-clip:text;
      margin-bottom:8px;letter-spacing:.5px;
    }
    .ai-reveal .body{font-size:12.5px;color:#6a5a4a;line-height:1.8}
    .ai-reveal .high{color:var(--purple);font-weight:600}
    .ai-reveal .arrow{font-size:16px;color:var(--purple);margin-top:6px;display:inline-block;animation:bounceY 2s ease-in-out infinite}

    /* ===== Course CTA (Premium Dark Card) ===== */
    .course-cta{
      width:calc(100% - 40px);max-width:440px;
      margin:14px 20px 0;
      background:linear-gradient(145deg,#2d204a,#1a1a2e);
      border-radius:18px;
      padding:24px 20px 20px;
      text-align:center;
      box-shadow:0 8px 32px rgba(45,32,74,.2);
      position:relative;overflow:hidden;
    }
    .course-cta .bg-glow{
      position:absolute;top:-50px;right:-50px;
      width:150px;height:150px;
      background:radial-gradient(circle,rgba(168,85,247,.2),transparent 70%);
      border-radius:50%;pointer-events:none;
    }
    .course-cta .bg-glow2{
      position:absolute;bottom:-30px;left:-30px;
      width:100px;height:100px;
      background:radial-gradient(circle,rgba(201,169,110,.1),transparent 70%);
      border-radius:50%;pointer-events:none;
    }
    .course-cta .cta-badge{
      display:inline-block;
      font-size:10px;
      background:rgba(240,221,160,.12);
      color:var(--gold-light);
      padding:3px 12px;
      border-radius:10px;
      letter-spacing:1px;
      margin-bottom:10px;
      position:relative;z-index:1;
    }
    .course-cta h3{
      font-size:19px;color:var(--gold-light);
      font-weight:700;margin-bottom:4px;
      letter-spacing:1px;
      position:relative;z-index:1;
    }
    .course-cta .desc{
      font-size:13px;color:#b8a0e0;
      line-height:1.7;margin-bottom:14px;
      position:relative;z-index:1;
    }
    .course-cta .feature-grid{
      display:grid;grid-template-columns:1fr 1fr 1fr;
      gap:8px;margin-bottom:16px;
      position:relative;z-index:1;
    }
    .course-cta .feature-item{
      background:rgba(255,255,255,.06);
      border-radius:10px;
      padding:10px 4px;
      text-align:center;
    }
    .course-cta .feature-item .fi-icon{font-size:22px;margin-bottom:4px}
    .course-cta .feature-item .fi-label{font-size:10px;color:#b8a0e0;line-height:1.3}
    .course-cta .price-row{
      display:flex;align-items:center;justify-content:center;
      gap:10px;margin-bottom:16px;
      position:relative;z-index:1;
    }
    .course-cta .price-current{
      font-size:28px;font-weight:700;
      color:var(--gold-light);
      letter-spacing:1px;
    }
    .course-cta .price-original{
      font-size:14px;color:#7a6a9e;
      text-decoration:line-through;
    }
    .course-cta .price-tag{
      font-size:10px;color:var(--gold-light);
      background:rgba(201,169,110,.15);
      padding:2px 8px;border-radius:4px;
    }
    .course-cta .cta-btn{
      display:block;padding:14px 0;
      background:linear-gradient(135deg,#d946ef,var(--purple));
      color:#fff;
      font-size:15px;font-weight:700;
      border:none;border-radius:24px;
      cursor:pointer;
      text-decoration:none;text-align:center;
      letter-spacing:1px;
      box-shadow:0 4px 20px rgba(168,85,247,.3);
      position:relative;z-index:1;
      transition:transform .2s ease, box-shadow .2s ease;
    }
    .course-cta .cta-btn:active{transform:scale(.97);box-shadow:0 2px 12px rgba(168,85,247,.2)}
    .course-cta .urgency{
      font-size:10.5px;color:#7a6a9e;
      margin-top:10px;position:relative;z-index:1;
    }
    .course-cta .cta-qr-wrap{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:4px}
    .course-cta .cta-qr-img{width:200px;height:auto;border-radius:14px;border:2px solid rgba(240,221,160,.25);box-shadow:0 4px 24px rgba(0,0,0,.25);background:#fff;padding:8px}

    /* ===== WeChat Card ===== */
    .wechat-card{
      width:calc(100% - 40px);max-width:440px;
      margin:14px 20px 0;
      padding:18px;
      background:#fff;
      border:1px solid rgba(224,213,197,.6);
      border-radius:var(--card-radius);
      text-align:center;
      box-shadow:0 2px 12px rgba(74,63,48,.04);
    }
    .wechat-card h4{font-size:14px;color:var(--brown);font-weight:600;margin-bottom:4px}
    .wechat-card .sub{
      font-size:11.5px;color:var(--brown-light);
      margin-bottom:12px;line-height:1.5;
    }
    .wechat-card .qr-wrap{
      display:flex;justify-content:center;margin-bottom:8px;
    }
    .wechat-card .qr-placeholder{
      width:120px;height:120px;
      background:linear-gradient(135deg,#f8f4ee,#f0e9dd);
      border:2px dashed rgba(201,169,110,.4);
      border-radius:12px;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      color:#a8946c;font-size:11px;gap:3px;line-height:1.4;
      transition:transform .2s ease;
    }
    .wechat-card .qr-placeholder:active{transform:scale(.96)}
    .wechat-card .social-proof{
      font-size:11px;color:#a8946c;
      margin-top:4px;
      display:flex;align-items:center;justify-content:center;gap:4px;
    }
    .wechat-card .social-proof .counter{
      color:var(--purple);font-weight:700;font-size:13px;
    }

    /* ===== Footer ===== */
    .footer{
      width:100%;padding:28px 24px 20px;
      margin-top:24px;
      border-top:1px solid rgba(224,213,197,.5);
      text-align:center;
    }
    .footer .brand{
      font-size:14px;color:var(--brown-light);
      letter-spacing:3px;font-weight:600;
    }
    .footer .sub{
      font-size:11px;color:#a8946c;
      margin-top:4px;letter-spacing:.5px;
    }
    .footer .divider{
      width:40px;height:2px;
      background:linear-gradient(90deg,var(--gold),var(--purple));
      margin:8px auto;
      border-radius:2px;
    }
    .footer .contact{
      font-size:11px;color:#b5a88a;
      margin-top:6px;
    }

    /* ===== Back to Top ===== */
    #back-top{
      position:fixed;bottom:30px;right:20px;
      width:42px;height:42px;
      border-radius:50%;
      background:linear-gradient(135deg,var(--gold),#a08050);
      color:var(--brown);
      border:none;
      font-size:18px;
      cursor:pointer;
      box-shadow:0 4px 16px rgba(201,169,110,.25);
      opacity:0;transform:translateY(20px);
      pointer-events:none;
      transition:all .3s var(--ease-out-expo);
      z-index:999;
      display:flex;align-items:center;justify-content:center;
    }
    #back-top.show{opacity:1;transform:translateY(0);pointer-events:auto}
    #back-top:active{transform:scale(.9)}

    /* ===== Modal ===== */
    .course-modal-overlay{
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,.55);
      z-index:9999;
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(3px);
      -webkit-backdrop-filter:blur(3px);
      opacity:0;pointer-events:none;
      transition:opacity .3s ease;
    }
    .course-modal-overlay.active{opacity:1;pointer-events:auto}
    .course-modal-box{
      background:linear-gradient(135deg,#fff,#faf6ef);
      max-width:340px;width:88%;
      border-radius:20px;
      padding:26px 18px 20px;
      text-align:center;
      position:relative;
      box-shadow:0 12px 40px rgba(0,0,0,.2);
      transform:scale(.9);
      transition:transform .35s var(--ease-spring);
    }
    .course-modal-overlay.active .course-modal-box{transform:scale(1)}
    .course-modal-close{
      position:absolute;top:10px;right:14px;
      border:none;background:none;
      font-size:20px;color:#aaa;
      cursor:pointer;padding:4px;line-height:1;
    }
  </style>
</head>
<body>

  <!-- ===== Progress Bar ===== -->
  <div id="progress-bar"></div>

  <!-- ===== Lightbox ===== -->
  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <button class="lightbox-close" onclick="closeLightbox()">鉁?/button>
    <img id="lightbox-img" src="${artwork.url}" alt="浣滃搧棰勮">
    <button class="lightbox-save" onclick="saveImage()">馃捑 淇濆瓨鍒扮浉鍐?/button>
  </div>

  <!-- ===== Back to Top ===== -->
  <button id="back-top" onclick="window.scrollTo({top:0,behavior:'smooth'})">鈫?/button>

  <!-- ===== Main Page ===== -->
  <div class="page">

    <!-- Brand Header (sticky) -->
    <div class="brand-header">
      <div class="logo-wrap">
        <img src="/logo-brand.png" alt="澶ц薄鏅虹粯AI绉戝垱" style="width:100%;height:100%;object-fit:contain;">
      </div>
      <div>
        <div class="brand-name">澶ц薄鏅虹粯AI绉戝垱</div>
        <div class="brand-tagline">20骞磋壓鏈暀鑲?路 AI鍒涙柊鏁欒偛寮曢鑰?/div>
      </div>
    </div>

    <!-- Brand Story (Glass Card) -->
    <div class="brand-story reveal reveal-delay-3">
      <span class="icon">馃</span>
      <h4>杩欏氨鏄疉I+鑹烘湳鐨勯瓟娉?/h4>
      <p>
        澶ц薄鏅虹粯AI绉戝垱锛屾繁鑰曡壓鏈暀鑲蹭簩鍗佷綑骞达紝铻嶅悎AI鍓嶆部鎶€鏈紝<br>
        璁╁瀛愮敤鎯宠薄鍔涜Е纰版湭鏉ャ€傝繖閲屽睍鍑虹殑姣忎竴骞呬綔鍝侊紝<br>
        閮芥槸瀛╁瓙鍒涙剰涓?em>AI鏅鸿兘</em>鐨勫叡鍚屾澃浣溿€?
      </p>
    </div>

    

    <!-- Share Bar -->
    <div class="share-bar reveal visible">
      <span class="share-hint">馃憜 鍒嗕韩缁欏ソ鍙嬫璧?/span>
      <button class="share-btn" onclick="sharePage()" title="鍒嗕韩">馃摛</button>
    </div>

    <!-- Hero Image -->
    <div class="hero hero-entrance">
      <div class="hero-inner">
        <div class="hero-badge">鉁?AI 鍏卞垱</div>
        <a href="${artwork.url}" id="img-link">
          <img src="${artwork.url}" alt="${safeName} 鐨勪綔鍝? id="hero-img" x-webkit-airdrop="save">
        </a>
        <div class="hero-tap-hint" id="hero-hint">馃憜 闀挎寜淇濆瓨鍥剧墖</div>
        <button onclick="saveImage()" style="margin-top:8px;width:100%;padding:10px;background:linear-gradient(135deg,#c9a96e,#a08050);border:none;border-radius:12px;color:#1a1410;font-size:14px;font-weight:600;cursor:pointer">馃捑 淇濆瓨鍥剧墖鍒扮浉鍐?/button>
      </div>
    </div>

    <!-- Info -->
    <div class="info reveal" style="transition-delay:0.3s">
      <div class="child-name"><span class="sub"> 鐨凙I鑹烘湳浣滃搧</span></div>
      <div class="date-badge"></div>
    </div>

    <!-- Tech Tags -->
    <div class="tech-tags reveal reveal-delay-2">
      <span class="tag purple">馃 AI鏂囩敓鍥?/span>
      <span class="tag gold">馃帹 鏁︾厡椋庢牸</span>
      <span class="tag green">鉁?鍗虫椂鐢熸垚</span>
    </div>

    <!-- Section Divider -->
    <div class="section-divider reveal reveal-delay-2">
      <div class="line"></div>
      <div class="dot">鉁?/div>
      <div class="line"></div>
    </div>

    <!-- AI Reveal -->
    <div class="ai-reveal reveal reveal-delay-3">
      <div class="icon">馃か</div>
      <div class="title">鎮勬倓鍛婅瘔浣?/div>
      <div class="body">
        鏈娲诲姩鐨勫叏閮ㄥ憟鐜板唴瀹?鈥?鍖呮嫭鎶曞睆灞曠ず銆佽繖涓綔鍝侀〉銆?br>浠ュ強浣犵湅鍒扮殑姣忎竴骞呬綔鍝?鈥?鍧囩敱 <span class="high">AI</span> 瀹炴椂鐢熸垚銆?br>
        AI鍒涗綔娌℃湁閭ｄ箞闅俱€?br>
        鏉ヤ簩妤硷紝浠庝竴鏀?<span class="high">AI鐭墖</span> 寮€濮嬨€?
      </div>
      <div class="arrow">鈫?/div>
    </div>

    <!-- Course CTA -->
    <div class="course-cta reveal reveal-delay-4">
      <div class="bg-glow"></div>
      <div class="bg-glow2"></div>
            <div class="cta-badge">馃 鐑棬浣撻獙 路 浜屾ゼ涓撲韩</div>
      <h3 style="font-size:17px;">馃 鏁︾厡鏂扮敓 路 AI鍔ㄧ敾鍒涗綔</h3>
      <p class="desc">
        甯﹀瀛愬垱閫犲睘浜庤嚜宸辩殑鏁︾厡鍔ㄧ敾<br>
        鎺屼腑鏁︾厡娣卞害浣撻獙鍖?
      </p>
      <div class="feature-grid">
        <div class="feature-item">
          <div class="fi-icon">馃</div>
          <div class="fi-label">AIGC鏁︾厡寰姩鐢?/div>
        </div>
        <div class="feature-item">
          <div class="fi-icon">馃挕</div>
          <div class="fi-label">杈撳叆浣犵殑鍒涙剰</div>
        </div>
        <div class="feature-item">
          <div class="fi-icon">馃幁</div>
          <div class="fi-label">鍒涢€犳暒鐓岃鑹?/div>
        </div>
      </div>
      <p class="desc" style="font-size:12px;color:#c9a96e;margin-top:-6px;margin-bottom:18px;">
        璁╀紶缁熸枃鍖栧湪鏁板瓧涓栫晫寮€鍚柊鐨勬梾绋?鉁?
      </p>
      <div class="cta-qr-wrap">
        <img src="/dunhuang-qr.png" alt="鏁︾厡鏂扮敓灏忕▼搴忕爜" class="cta-qr-img" />
        <div class="urgency">馃憜 闀挎寜鍥剧墖璇嗗埆 路 浜嗚В鏁︾厡鏂扮敓璇︽儏</div>
      </div>
    </div>

        
    <!-- ===== Separator ===== -->
    <div class="section-divider reveal reveal-delay-4">
      <div class="line"></div>
      <div class="dot">鉁?/div>
      <div class="line"></div>
    </div>
<!-- ===== Brand Intro ===== -->
    <div class="brand-story reveal reveal-delay-4" style="margin-top:20px;">
      <div class="icon" style="font-size:22px;">馃悩</div>
      <h4>鍏充簬澶ц薄鑹烘湳</h4>
      <p style="text-align:left;font-size:12px;">
        澶ц薄鑹烘湳鍜屼竴蹇垫暒鐓屽睍鏂规繁搴﹀悎浣滐紝涓哄睍瑙堢爺鍙戠殑銆婃帉涓暒鐓屄稟I鍔ㄧ敾鍒涗綔銆嬭绋嬪凡鍚屾瀹樻柟灏忕▼搴忋€傝绋嬫帰绱?鏁︾厡+浜哄伐鏅鸿兘+鑹烘湳鏁欒偛"鐨勮瀺鍚堟ā寮忥紝璁╁崈骞存枃鍖栦互鍔ㄧ敾銆佸奖鍍忕瓑骞磋交鍖栨柟寮忛噸鏂拌〃杈撅紝鎵撻€犻潰鍚戞湭鏉ラ潚灏戝勾鐨勬暟瀛楁枃鍖栫爺瀛︽柊鏂瑰悜銆?
      </p>
      <div style="height:10px;"></div>
      <p style="text-align:left;font-size:12px;">
        路 涓撴敞涓洪潚灏戝勾鎻愪緵铻嶅悎鍏ㄧ悆瑙嗛噹鐨勫墠鐬绘€?鑹烘湳+绉戞妧"鏁欒偛<br>
        路 鎷ユ湁鑷富鐮斿彂鐨凙I鑹烘湳鍒涗綔鏁欏浣撶郴<br>
        路 鎵庢牴骞垮窞鐨勪笓涓氳壓鏈満鏋?0+骞?br>
        路 浠ョ敾杞介亾锛屾壙鎵樼悊鎯?
      </p>
    </div>

    <!-- WeChat Card -->
    <div class="wechat-card reveal reveal-delay-5" style="margin-bottom:30px;">
      <h4>馃摫 浜嗚В鏇村鑹烘湳鍒涗綔涓嶢I璇剧▼</h4>
      <p class="sub">
        鎵爜娣诲姞寰俊锛岃幏鍙栨洿澶欰I鑹烘湳鍒涗綔璧勮<br>
        浜嗚В璇剧▼璇︽儏涓庝笓灞炵鍒?
      </p>
      <div class="qr-wrap">
        <div class="qr-placeholder">
          <span style="font-size:26px">馃摫</span>
          <span>鎵爜鍔犲井淇?/span>
          <span style="font-size:10px">璇锋浛鎹负瀹為檯浜岀淮鐮?/span>
        </div>
      </div>
    </div><!-- Course Modal -->
  <div class="course-modal-overlay" id="courseModal" onclick="hideCourseModal()">
    <div class="course-modal-box" onclick="event.stopPropagation()">
      <button class="course-modal-close" onclick="hideCourseModal()">鉁?/button>
      <div style="font-size:40px;margin-bottom:8px">馃幀</div>
      <h3 style="font-size:18px;color:var(--brown);margin-bottom:4px">浜屾ゼ 路 AI寰數褰辫</h3>
      <p style="font-size:13px;color:#7a6a52;margin-bottom:12px;line-height:1.6">
        30鍒嗛挓锛岃鍒氭墠鍒涗綔鐨勮鑹?br>
        鍙樻垚鍔ㄧ敾鐭墖涓昏锛?
      </p>
      <div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">馃帹 AI瑙掕壊鐢熸垚</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">馃彏 鍦烘櫙鍒涗綔</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">馃幀 15绉掑ぇ鐗?/span>
      </div>
      <div style="margin-bottom:14px">
        <strong style="font-size:26px;color:var(--brown)">楼125</strong>
        <s style="font-size:14px;color:#aaa;margin-left:8px">鍘熶环楼198</s>
      </div>
      <div style="margin-bottom:10px">
        <div style="width:120px;height:120px;background:#f8f4ee;border:2px dashed #d4c5aa;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a8946c;font-size:11px;gap:4px;margin:0 auto">
          <span style="font-size:26px">馃摫</span>
          <span>鎵爜鍔犲井淇?/span>
          <span style="font-size:10px">鏇挎崲涓哄疄闄呬簩缁寸爜</span>
        </div>
      </div>
      <p style="font-size:11px;color:#a8946c">鍙戦€佷綔鍝佺紪鍙?路 浼樺厛棰勭暀鍚嶉</p>
    </div>
  </div>

  <script>
    // ===== Reading Progress Bar =====
    window.addEventListener('scroll', function(){
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var scrollPos = window.scrollY;
      var progress = docHeight > 0 ? (scrollPos / docHeight) * 100 : 0;
      document.getElementById('progress-bar').style.width = progress + '%';
    });

    // ===== Scroll Reveal (IntersectionObserver) =====
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal').forEach(function(el){
      observer.observe(el);
    });

    // ===== Back to Top Button =====
    window.addEventListener('scroll', function(){
      var btn = document.getElementById('back-top');
      if(window.scrollY > 500){
        btn.classList.add('show');
      } else {
        btn.classList.remove('show');
      }
    });

    // ===== Lightbox =====
    function openLightbox(){
      var src = document.getElementById('hero-img').src;
      document.getElementById('lightbox-img').src = src;
      document.getElementById('lightbox').classList.add('active');
    }
    function closeLightbox(){
      document.getElementById('lightbox').classList.remove('active');
    }
        function saveImage(){
      var img = document.getElementById("hero-img") || document.getElementById("lightbox-img");
      if (!img) { showToast("鉂?鏃犳硶鎵惧埌鍥剧墖"); return; }
      var imgSrc = img.src;
      // Open in new tab (works in WeChat for long-press save)
      window.open(imgSrc, "_blank");
      showToast("鉁?宸插湪鏂扮獥鍙ｆ墦寮€锛岄暱鎸夋垨鍙抽敭淇濆瓨");
    }

    // ===== Web Share API =====    // ===== Web Share API =====
    function sharePage(){
      if(navigator.share){
        navigator.share({
          title: '鐨凙I鑹烘湳浣滃搧 | 澶ц薄鏅虹粯AI绉戝垱',
          text: '蹇潵娆ｈ祻鎴戝湪骞垮窞缇庢湳棣嗙敤AI鍒涗綔鐨勬暒鐓岄鏍间綔鍝侊紒',
          url: window.location.href
        }).catch(function(){});
      } else {
        // Fallback: copy link
        var input = document.createElement('input');
        input.value = window.location.href;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('馃敆 閾炬帴宸插鍒?);
      }
    }

    // ===== Modal =====
    function showCourseModal(){
      document.getElementById('courseModal').classList.add('active');
    }
    function hideCourseModal(){
      document.getElementById('courseModal').classList.remove('active');
    }

    // ===== Simple Toast =====
    function showToast(msg){
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(61,48,32,.85);color:#f0dda0;padding:10px 22px;border-radius:22px;font-size:13px;z-index:99999;backdrop-filter:blur(8px);animation:fadeInOut 2s ease forwards';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function(){ t.remove(); }, 2000);
    }

    // ===== Inject Toast Keyframes =====
    var style = document.createElement('style');
    style.textContent = '@keyframes fadeInOut{0%{opacity:0;transform:translateX(-50%) translateY(10px)}15%{opacity:1;transform:translateX(-50%) translateY(0)}85%{opacity:1;transform:translateX(-50%) translateY(0)}100%{opacity:0;transform:translateX(-50%) translateY(-10px)}}';
    document.head.appendChild(style);

          // ===== WeChat detection for hero hint =====
      (function(){
        var ua = navigator.userAgent.toLowerCase();
        if(ua.indexOf("micromessenger") > -1){
          var hint = document.getElementById("hero-hint");
          if(hint) hint.innerHTML = "馃憜 闀挎寜淇濆瓨鍥剧墖";
        }
      })();

      // ===== Set Hero Image on Load =====
    document.getElementById('hero-img').addEventListener('load', function(){
      // Image loaded - animations continue
    });
  
      </script>btn.textContent = '鈴?澶勭悊涓?..';
    btn.disabled = true;
    var img = document.getElementById('hero-img');
    if (!img || !img.complete) { btn.textContent = '馃捑 淇濆瓨浣滃搧鍥剧墖'; btn.disabled = false; return; }
    try {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function(blob) {
        if (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'AIzuopin.png';
          document.body.appendChild(a);
          a.click();
          setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
          btn.textContent = '鉁?宸蹭繚瀛橈紒';
        } else {
          window.open(img.src, '_blank');
          btn.textContent = '馃捑 淇濆瓨浣滃搧鍥剧墖';
        }
        setTimeout(function() { btn.disabled = false; btn.textContent = '馃捑 淇濆瓨浣滃搧鍥剧墖'; }, 3000);
      }, 'image/png');
    } catch(e) {
      window.open(img.src, '_blank');
      btn.textContent = '馃捑 淇濆瓨浣滃搧鍥剧墖';
      btn.disabled = false;
    }
  }
  function copyShareLink() {
    var url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function() {
        var btn = document.getElementById('copyBtn');
        btn.textContent = '鉁?宸插鍒?;
        setTimeout(function() { btn.textContent = '馃搵 澶嶅埗閾炬帴'; }, 2000);
      }).catch(function() { fallbackCopy(url); });
    } else { fallbackCopy(url); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy');
      var btn = document.getElementById('copyBtn');
      btn.textContent = '鉁?宸插鍒?;
      setTimeout(function() { btn.textContent = '馃搵 澶嶅埗閾炬帴'; }, 2000);
    } catch(e) {}
    document.body.removeChild(ta);
  }
  </script>
  <!-- Course enrollment modal -->
  <div id="courseModal" class="course-modal-overlay" style="display:none" onclick="hideCourseModal()">
    <div class="course-modal-box" onclick="event.stopPropagation()">
      <button class="course-modal-close" onclick="hideCourseModal()">鉁?/button>
      <div style="font-size:40px;margin-bottom:8px">馃幀</div>
      <h3 style="font-size:18px;color:#3d3020;margin-bottom:4px">浜屾ゼ路AI寰數褰辫</h3>
      <p style="font-size:13px;color:#7a6a52;margin-bottom:12px;line-height:1.6">30鍒嗛挓,璁╁瀛愬垰鎵嶅垱浣滅殑瑙掕壊<br>鍙樻垚鍔ㄧ敾鐭墖涓昏锛?/p>
      <div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">鉁?AI瑙掕壊鐢熸垚</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">馃帹 鍦烘櫙鍒涗綔</span>
        <span style="font-size:11px;color:#7a6a52;background:rgba(201,169,110,.12);padding:4px 10px;border-radius:8px">馃摻锔?15绉掑ぇ鐗?/span>
      </div>
      <div style="margin-bottom:14px">
        <strong style="font-size:26px;color:#3d3020">楼125</strong>
        <s style="font-size:14px;color:#aaa;margin-left:8px">鍘熶环楼198</s>
      </div>
      <div style="margin-bottom:10px">
        <div style="width:120px;height:120px;background:#f8f4ee;border:2px dashed #d4c5aa;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#a8946c;font-size:11px;gap:4px;margin:0 auto">
          <span style="font-size:26px">馃摬</span>
          <span>鎵爜鍔犲井淇?/span>
          <span style="font-size:10px">鏇挎崲瀹為檯浜岀淮鐮?/span>
        </div>
      </div>
      <p style="font-size:11px;color:#a8946c">鍙戦€佷綔鍝佺紪鍙?浼樺厛棰勭暀鍚嶉</p>
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

// 鍘嬬缉鍥剧墖涓?jpg 骞跺瓨鍏?PageFire 閮ㄧ讲鐩綍锛堟柟渚跨敤鎴峰湪鎵嬫満绔繚瀛橈級

function generateAllWorkPages() {
  artworks.forEach(a => {
    generateWorkPage(a);
    generatePagefireWorkPage(a);
    const pfPngPath = path.join(PAGEFIRE_ARTWORKS_DIR, a.id + '.png');
    if (!fs.existsSync(pfPngPath)) compressForPagefire(a);
  });
}

function generatePagefireWorkPage(artwork) {
  const displayDate = artwork.date
    ? `${artwork.date.slice(0,4)}骞?{artwork.date.slice(4,6)}鏈?{artwork.date.slice(6,8)}鏃
    : '';
  const webpId = artwork.id;
  const safeName = artwork.name.replace(/"/g, '\"');

  
  // CDN URL resolution: use global CDN map if available
  const cdnUrl = (global.__cdnMap && global.__cdnMap[webpId]) || null;
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${safeName}鐨凙I鑹烘湳浣滃搧 路 澶ц薄鏅虹粯AI绉戝垱</title>
  <meta property="og:title" content="${safeName}鐨勬暒鐓孉I鑹烘湳浣滃搧 | 澶ц薄鏅虹粯AI绉戝垱">
  <meta property="og:description" content="澶ц薄鏅虹粯AI绉戝垱 路 10骞磋壓鏈暀鑲茬粡楠屆桝I鍒涙柊鏁欒偛銆傛垜鍦ㄥ箍宸炵編鏈鐢ˋI鍒涗綔浜嗕竴骞呮暒鐓岄鏍间綔鍝?蹇潵鐪嬬湅鍚э紒">
  <meta property="og:image" content="cdnUrl || (PAGEFIRE_BASE_URL + '/artworks/' + webpId + '.png')">
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
    .hero-img-wrap{display:block;position:relative}
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
    .dh-qr-section{width:calc(100% - 40px);max-width:440px;margin:14px 20px 0;background:linear-gradient(135deg,#3d3020,#2a2218);border-radius:16px;padding:22px 18px 18px;text-align:center;box-shadow:0 6px 24px rgba(61,48,32,.18)}
    .dh-qr-section .cta-badge{display:inline-block;font-size:11px;background:rgba(240,221,160,.15);color:#f0dda0;padding:3px 12px;border-radius:10px;letter-spacing:1px;margin-bottom:10px}
    .dh-qr-section h3{font-size:17px;color:#f0dda0;font-weight:700;margin-bottom:6px;letter-spacing:1px}
    .dh-qr-section .desc{font-size:12.5px;color:#c9a96e;line-height:1.7;margin-bottom:14px}
    .dh-qr-section .cta-qr-wrap{display:flex;flex-direction:column;align-items:center;gap:10px}
    .dh-qr-section .cta-qr-img{width:200px;height:auto;border-radius:14px;border:2px solid rgba(240,221,160,.25);box-shadow:0 4px 24px rgba(0,0,0,.25);background:#fff;padding:8px}
    .dh-qr-section .urgency{font-size:11px;color:#c9a96e;opacity:.8}
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
        <img src="../logo.png" alt="??????AI???">
      </div>
      <div class="brand-text">
        <div class="brand-name">??????AI???</div>
        <div class="brand-tagline">10???????????? AI???????????/div>
      </div>
    </div>
    <div class="hero">
      <div class="hero-label">AI ???</div>
     <div class="hero-img-wrap">
        <img src="${cdnUrl || ("../artworks/" + webpId + ".png")}" alt="${safeName}????? id="hero-img" />
     </div>
        <div class="hero-tap-hint">?? ?????????????????/div>
    </div>
    <div class="info">
      <div class="child-name">${safeName}<span class="sub">??I??????</span></div>
      
    </div>
    <div class="save-tip" id="save-tip">?? ???????????? ???????????????????????????/div>
    <div style="width:calc(100% - 40px);max-width:440px;margin:12px 20px 0;display:flex;gap:8px">
      <button id="saveBtn" onclick="saveWorkImage()" style="flex:1;padding:12px 0;background:linear-gradient(135deg,#c9a96e,#a08050);border:none;border-radius:20px;font-size:15px;font-weight:600;color:#1a1410;cursor:pointer;letter-spacing:1px;text-align:center">?? ?????????</button>
      <button id="copyBtn" onclick="copyShareLink()" style="padding:12px 16px;background:rgba(201,169,110,.12);border:1px solid rgba(201,169,110,.25);border-radius:20px;font-size:13px;color:#7a6a52;cursor:pointer;white-space:nowrap">?? ??????</button>
    </div>
    <div class="brand-statement">
      <div class="icon">??</div>
      <h4>?????I+????????/h4>
      <p>??????AI???,??????????????,???AI???????<br>??????????????????????????????????<br>???????????I?????????????/p>
    </div>
    <div class="course-cta">
      <div class="cta-badge">?? ?????? ? ??????</div>
      <h3>?? AI????????????</h3>
      <p class="desc">?????????????????30?????????????????br>????????????,??????????????</p>
      <div class="features">
        <span>??AI??????</span>
        <span>?? ??????</span>
        <span>????15?????/span>
      </div>
      <div class="price-row">
        <span class="price-current">?125</span>
        <span class="price-original">?198</span>
        <span class="price-tag">??????</span>
      </div>
      <a class="cta-btn" href="javascript:;" onclick="showCourseModal()">?? ????????????</a>
      <div class="urgency">????????12??? ???????????????</div>
    </div>
    <div class="dh-qr-section">
      <div class="cta-qr-wrap">
        <img src="/????????png" alt="?????????????" class="cta-qr-img" />
        <div class="urgency">?? ??????????????/div>
      </div>
    </div>
    <div class="wechat-card">
      <h4>?? ?????? ?????????</h4>
      <p class="sub">??????,????????????????br>??????AI??????????????/p>
      <div class="qrcode">
        <div class="qr-placeholder">
          <span style="font-size:28px">??</span>
          <span>????????/span>
          <span style="font-size:10px">??????????????/span>
        </div>
      </div>
      <p class="social-proof">??? 200+ ??????????????I????????? ??</p>
    </div>
  <style>
    .course-modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
    .course-modal-box{background:linear-gradient(135deg,#fff,#faf6ef);max-width:340px;width:88%;border-radius:20px;padding:26px 18px 20px;text-align:center;position:relative;box-shadow:0 12px 40px rgba(0,0,0,.2);animation:modalAnim .25s ease-out}
    @keyframes modalAnim{0%{opacity:0;transform:scale(.9)}100%{opacity:1;transform:scale(1)}}
    .course-modal-close{position:absolute;top:10px;right:14px;border:none;background:none;font-size:20px;color:#aaa;cursor:pointer;padding:4px;line-height:1}
  </style>

    <div class="footer">
      <div class="brand">????</div>
      <div class="sub">� 2026 ????AI?? � ????AI+???????</div>
    </div>
  </body>
</html>`;

  const filePath = path.join(PAGEFIRE_WORKS_DIR, artwork.id + '.html');
  fs.writeFileSync(filePath, html, 'utf-8');
}

// 鍘嬬缉鍥剧墖涓?webp 骞跺瓨鍏?PageFire 閮ㄧ讲鐩綍



function compressForPagefire(artwork) {
  try {
    const srcPath = path.join(ARTWORKS_DIR, artwork.filename);
  const dstPath = path.join(PAGEFIRE_ARTWORKS_DIR, artwork.id + '.jpg');
    if (!fs.existsSync(srcPath)) return;
    const promises = [];

    // 浠庢簮鏂囦欢锛坥riginals/{id}.{ext}锛夐噸鏂拌鍓悗杞负 PNG锛岀敤浜庡井淇″垎浜〉
    const origExts = ['.png', '.jpg', '.jpeg'];
    let sourceUsed = false;
    for (const ext of origExts) {
      const origSrc = path.join(ORIGINALS_DIR, artwork.id + ext);
      if (fs.existsSync(origSrc)) {
        // 鑷姩鎶犲浘浣滃搧锛氫粠婧愭枃浠朵竴姝ュ埌浣嶈鍓?+ 杞?PNG锛堜笉缁忚繃 _c 涓棿鏂囦欢锛?
        // 瑁佸壀鍙傛暟涓?auto-matting 涓€鑷达細102x152mm 璁捐鍗? 涓?/宸﹀彸8/涓?2mm
        (async () => {
          try {
            const meta = await sharp(origSrc).metadata();
            const cropRegion = {
              left: Math.round(meta.width * 8 / 102),
              top: Math.round(meta.height * 8 / 152),
              width: Math.round(meta.width * (102 - 8 - 8) / 102),
              height: Math.round(meta.height * (152 - 8 - 32) / 152)
            };
            const pngDst = path.join(PAGEFIRE_ARTWORKS_DIR, artwork.id + '.png');
            const jpgDst = path.join(PAGEFIRE_ARTWORKS_DIR, artwork.id + '.jpg');
            promises.push(sharp(origSrc).extract(cropRegion).png().toFile(pngDst));
            promises.push(sharp(origSrc).extract(cropRegion).jpeg({ quality: 92 }).toFile(jpgDst));
          } catch (e) {
            console.error('PageFire 婧愭枃浠惰鍓け璐?', artwork.id, e.message);
          }
        })();
        sourceUsed = true;
        break;
      }
    }
    if (!sourceUsed) {
      // 鎵嬪姩涓婁紶浣滃搧锛氱敤 artworks/ 涓殑鏂囦欢锛堢洿鎺ヨ浆锛屼笉瑁佸壀锛?
      const fullSrc = path.join(ARTWORKS_DIR, artwork.filename);
      if (fs.existsSync(fullSrc)) {
        const pngDst = path.join(PAGEFIRE_ARTWORKS_DIR, artwork.id + '.png');
        const jpgDst = path.join(PAGEFIRE_ARTWORKS_DIR, artwork.id + '.jpg');
        promises.push(sharp(fullSrc).png().toFile(pngDst));
        promises.push(sharp(fullSrc).jpeg({ quality: 92 }).toFile(jpgDst));
      }
    }

    // 濡傛灉鏈夎鍓増鍘熷浘锛堝幓杈硅窛锛夛紝涔熻浆涓?jpg锛堝ぇ灞忕壒鍐欏睍绀虹敤锛?
    const cropExts = ['.png', '.jpg', '.jpeg'];
    for (const ext of cropExts) {
      const cropSrc = path.join(ORIGINALS_DIR, artwork.id + '_c' + ext);
      if (fs.existsSync(cropSrc)) {
        const cropDst = path.join(PAGEFIRE_ARTWORKS_DIR, artwork.id + '_c.jpg');
        promises.push(
          sharp(cropSrc).jpeg({ quality: 92 }).toFile(cropDst)
        );
        break;
      }
    }
    Promise.all(promises).catch(e => {
      console.error('PageFire 鍥剧墖杞崲澶辫触:', e.message);
    });

    // === CDN 涓婁紶锛氬皢瑁佸壀鐗堜笂浼犲埌 img.hkting.com 鍥惧簥 ===
    // 浣跨敤 artworks/{id}.png 锛堝凡瑁佸壀+鍘昏儗鏅紝浣嗗彧淇濈暀鐢讳綔鏈韩锛?
    // 鎴?originals/{id}_c.{ext} 锛堣鍓増锛屼繚鐣欒璁″崱鐧借壊鑳屾櫙锛?
    (async () => {
      try {
        // 浼樺厛鐢?originals 涓殑瑁佸壀鐗堬紙淇濈暀鑳屾櫙锛?
        let cdnSrc = null;
        const cropExts = ['.png', '.jpg', '.jpeg'];
        for (const ext of cropExts) {
          const p = path.join(ORIGINALS_DIR, artwork.id + '_c' + ext);
          if (fs.existsSync(p)) { cdnSrc = p; break; }
        }
        // 娌℃湁瑁佸壀鐗堬紝鐢?artworks 涓殑鍝佹垚
        if (!cdnSrc) {
          const p = path.join(ARTWORKS_DIR, artwork.filename);
          if (fs.existsSync(p)) cdnSrc = p;
        }
        if (!cdnSrc) return;

        const resp = await fetch('https://vapi.hkting.com/api/open-api/v1/files/upload', {
          method: 'POST',
          headers: { 'X-Api-Key': 'ak_CgQovFi4LpzbHqjnsrmnL1albkGaJt5oTqyKfLSz' },
          body: (() => {
            const fd = new FormData();
            fd.append('file', fs.createReadStream(cdnSrc));
            fd.append('mode', 'compress');
            fd.append('quality', '0.92');
            return fd;
          })()
        });
        const data = await resp.json();
        if (data.code === 0 && data.data && data.data.url) {
          // 淇濆瓨 CDN URL 鍒板叏灞€鏄犲皠
          if (!global.__cdnMap) global.__cdnMap = {};
          global.__cdnMap[artwork.id] = data.data.url;
          console.log('CDN uploaded:', artwork.id, data.data.url.slice(0, 50));
        }
      } catch (e) {
        console.error('CDN upload failed:', artwork.id, e.message);
      }
    })();

  } catch (e) {
    console.error('PageFire 鍥剧墖鍚屾澶辫触:', e.message);
  }
}

// 寤惰繜閮ㄧ讲 PageFire(闃查噸澶嶈Е鍙?15绉掑唴澶氭璋冪敤鍙儴缃蹭竴娆?
let pagefireDeployTimer = null;
// ===== Rembg HTTP 璋冪敤 =====

const recentAutoMatting = new Map();
const DEDUP_WINDOW = 30000;
async function callRembg(imagePath) {
  const imageData = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);
  const boundary = '----Rembg' + crypto.randomBytes(8).toString('hex');
  const header = Buffer.from(
    `--${boundary}\r
` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r
` +
    `Content-Type: application/octet-stream\r
\r
`
  );
  const footer = Buffer.from(`\r
--${boundary}--\r
`);
  const body = Buffer.concat([header, imageData, footer]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`Rembg timeout (${REMBG_TIMEOUT/1000}s)`)); }, REMBG_TIMEOUT);
    const req = http.request({ hostname: REMBG_HOST, port: REMBG_PORT, path: '/api/remove', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, (res) => {
      clearTimeout(timer);
      if (res.statusCode !== 200) { reject(new Error(`Rembg HTTP ${res.statusCode}`)); return; }
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.write(body); req.end();
  });
}
function schedulePagefireDeploy() {
  if (pagefireDeployTimer) clearTimeout(pagefireDeployTimer);
  pagefireDeployTimer = setTimeout(() => {
    console.log('鑷姩閮ㄧ讲 PageFire...');
    exec('npx pagefire deploy --dir deploy-pagefire', { cwd: __dirname }, (err, stdout, stderr) => {
      if (err) console.error('PageFire 閮ㄧ讲澶辫触:', err.message);
      else console.log('PageFire 閮ㄧ讲瀹屾垚:', stdout.slice(0, 200));
    });
  }, 15000);
}

// ===== API: 浣滃搧绠＄悊 =====

// 鑾峰彇鎵€鏈変綔鍝?灞曠ず椤靛彧杩斿洖鍦ㄦ灦鐨?
app.get('/api/artworks', (req, res) => {
  res.json(artworks.filter(a => a.status === 'active'));
});

// 鑾峰彇鍏ㄩ儴浣滃搧(绠＄悊鍚庡彴,鍚凡褰掓。)
app.get('/api/artworks/all', (req, res) => {
  res.json(artworks);
});

// 缁熻
app.get('/api/artworks/stats', (req, res) => {
  const active = artworks.filter(a => a.status === 'active').length;
  const archived = artworks.filter(a => a.status === 'archived').length;
  res.json({ total: artworks.length, active, archived });
});

// 浠婃棩寮曟祦鐪嬫澘
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

// ===== 鏁版嵁鐪嬫澘 API =====
// 鑾峰彇鍏ㄩ儴鏁版嵁鐪嬫澘璁板綍(鍚綔鍝佺粺璁?
app.get('/api/dashboard', (req, res) => {
  const records = Object.entries(dashboardData).map(([date, data]) => ({
    date,
    ...data
  })).sort((a, b) => b.date.localeCompare(a.date)); // 鏈€鏂板湪鍓?

  res.json({ records });
});

// 鑾峰彇/淇濆瓨浠婃棩鐪嬫澘鏁版嵁
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

// 鑷姩鎶犲浘涓婁紶
app.post('/api/auto-matting', uploadArtwork.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });
  const { name, date } = req.body;
  const artworkName = name || '鍖垮悕灏忕敾瀹?;
  const lastTime = recentAutoMatting.get(artworkName);
  if (lastTime && Date.now() - lastTime < DEDUP_WINDOW) {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    return res.json({ success: false, duplicate: true });
  }
  recentAutoMatting.set(artworkName, Date.now());
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  const originalPath = req.file.path;
  const originalExt = path.extname(req.file.filename).toLowerCase();
  try {
        const originalFilename = id + originalExt;
    const fullOriginalPath = path.join(ORIGINALS_DIR, originalFilename);
    fs.copyFileSync(originalPath, fullOriginalPath);

    // 鍏堣鍓師鍥撅紙鎸夎璁″崱瑙勬牸鍘昏竟璺濓級
    const cropMeta = await sharp(fullOriginalPath).metadata();
    const origCrop = {
      left: Math.round(cropMeta.width * 8 / 102),
      top: Math.round(cropMeta.height * 8 / 152),
      width: Math.round(cropMeta.width * (102 - 8 - 8) / 102),
      height: Math.round(cropMeta.height * (152 - 8 - 32) / 152)
    };
    console.log('[AutoMatting] Crop original: ' + origCrop.left + ',' + origCrop.top + ' ' + origCrop.width + 'x' + origCrop.height);
    const croppedOriginalPath = path.join(ORIGINALS_DIR, id + '_c' + originalExt);
    await sharp(fullOriginalPath).extract(origCrop).toFile(croppedOriginalPath);

    // 鍐嶅瑁佸壀鍚庣殑鍘熷浘鎶犲浘
    const mattedData = await callRembg(croppedOriginalPath);
    console.log('[AutoMatting] Matted OK: ' + mattedData.length + ' bytes');

    // 淇濆瓨鎶犲浘缁撴灉锛堝昂瀵镐笌瑁佸壀鍚庣殑鍘熷浘涓€鑷达級
    const mattedFilename = id + '.png';
    const mattedPath = path.join(ARTWORKS_DIR, mattedFilename);
    fs.writeFileSync(mattedPath, mattedData);

    // 娓呯悊 multer 涓存椂鏂囦欢
    if (originalPath !== mattedPath) { try { fs.unlinkSync(originalPath); } catch(e) {} }

const artwork = {
      id, name: artworkName,
      date: date || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      filename: mattedFilename,
      url: '/uploads/artworks/' + mattedFilename,
      originalUrl: '/uploads/originals/' + id + '_c' + originalExt,
      status: 'active', createdAt: Date.now(), autoMatting: true
    };
    artworks.push(artwork);
    saveData(ARTWORKS_FILE, artworks);
    trackNewArtwork(1);
    generateWorkPage(artwork);
    compressForPagefire(artwork);
    schedulePagefireDeploy();
    io.emit('artwork:new', artwork);
    res.json({ success: true, matted: true, artwork });
  } catch (err) {
    try { fs.unlinkSync(originalPath); } catch(e) {}
    res.json({ success: false, matted: false, error: err.message });
  }
});

// 涓婁紶浣滃搧
// ===== 杩借釜API =====
app.post('/api/track/cta-click', express.json(), (req, res) => {
  const { artworkId } = req.body || {};
  trackCtaClick(artworkId || 'unknown');
  res.json({ success: true });
});

app.post('/api/artworks/upload', uploadArtwork.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '璇烽€夋嫨鍥剧墖' });

  const { name, date } = req.body;
  const artwork = {
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    name: name || '鍖垮悕灏忕敾瀹?,
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
  schedulePagefireDeploy(); // 鑷姩閮ㄧ讲鍒板叕缃?

  // 瀹炴椂鎺ㄩ€佸埌灞曠ず椤?
  io.emit('artwork:new', artwork);

  res.json({ success: true, artwork });
});

// 涓嬫灦浣滃搧(褰掓。,涓嶇Щ闄ゆ暟鎹?
app.put('/api/artworks/:id/archive', (req, res) => {
  const { id } = req.params;
  const artwork = artworks.find(a => a.id === id);
  if (!artwork) return res.status(404).json({ error: '浣滃搧涓嶅瓨鍦? });

  artwork.status = 'archived';
  artwork.archivedAt = Date.now();
  saveData(ARTWORKS_FILE, artworks);

  // 娣诲姞鍒板綊妗ｈ褰?姘镐箙淇濈暀)
  const existing = archive.find(a => a.id === id);
  if (!existing) {
    archive.push({ ...artwork });
    saveData(ARCHIVE_FILE, archive);
  }

  io.emit('artwork:archive', { id });
  res.json({ success: true, artwork });
});

// 閲嶆柊涓婃灦
app.put('/api/artworks/:id/restore', (req, res) => {
  const { id } = req.params;
  const artwork = artworks.find(a => a.id === id);
  if (!artwork) return res.status(404).json({ error: '浣滃搧涓嶅瓨鍦? });

  artwork.status = 'active';
  delete artwork.archivedAt;
  saveData(ARTWORKS_FILE, artworks);

  // 浠庡綊妗ｈ褰曚腑绉婚櫎
  archive = archive.filter(a => a.id !== id);
  saveData(ARCHIVE_FILE, archive);

  io.emit('artwork:restore', { id, artwork });
  res.json({ success: true, artwork });
});

// 褰诲簳鍒犻櫎(浠庢墍鏈夎褰曚腑娓呴櫎,鍖呮嫭鏂囦欢)
app.delete('/api/artworks/:id/purge', (req, res) => {
  const { id } = req.params;
  const idx = artworks.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: '浣滃搧涓嶅瓨鍦? });

  const artwork = artworks[idx];
  const filePath = path.join(ARTWORKS_DIR, artwork.filename);

  artworks.splice(idx, 1);
  saveData(ARTWORKS_FILE, artworks);

  // 浠庡綊妗ｄ腑绉婚櫎
  archive = archive.filter(a => a.id !== id);
  saveData(ARCHIVE_FILE, archive);

  // 鍒犻櫎闈欐€佷綔鍝侀〉
  const workPagePath = path.join(WORKS_DIR, id + '.html');
  if (fs.existsSync(workPagePath)) fs.unlinkSync(workPagePath);
  // 鍒犻櫎 PageFire 鐗堟湰
  const pfWorkPath = path.join(PAGEFIRE_WORKS_DIR, id + '.html');
  const pfImgPath = path.join(PAGEFIRE_ARTWORKS_DIR, id + '.jpg');
  const pfCropImgPath = path.join(PAGEFIRE_ARTWORKS_DIR, id + '_c.jpg');
  try { if (fs.existsSync(pfWorkPath)) fs.unlinkSync(pfWorkPath); } catch(e) {}
  try { if (fs.existsSync(pfImgPath)) fs.unlinkSync(pfImgPath); } catch(e) {}
  try { if (fs.existsSync(pfCropImgPath)) fs.unlinkSync(pfCropImgPath); } catch(e) {}

  // 鍒犻櫎鍘熸枃浠?
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { console.error('鍒犻櫎鏂囦欢澶辫触:', e); }
  }

  io.emit('artwork:purge', { id });
  res.json({ success: true });
});

// 鎵归噺涓婁紶
app.post('/api/artworks/batch', uploadArtwork.array('images', 50), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '璇烽€夋嫨鍥剧墖' });

  const { names, dates } = req.body;
  const nameList = names ? JSON.parse(names) : [];
  const dateList = dates ? JSON.parse(dates) : [];
  const newArtworks = [];

  req.files.forEach((file, i) => {
    const id = path.basename(file.filename, path.extname(file.filename));
    const artwork = {
      id,
      name: nameList[i] || '鍖垮悕灏忕敾瀹?,
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
  schedulePagefireDeploy(); // 鑷姩閮ㄧ讲鍒板叕缃?
  io.emit('artworks:batch', newArtworks);

  res.json({ success: true, count: newArtworks.length, artworks: newArtworks });
});

// ===== API: 鑳屾櫙鍥剧鐞?=====

// 鑾峰彇鑳屾櫙閰嶇疆
app.get('/api/background', (req, res) => {
  res.json(bgConfig);
});

// 涓婁紶鑳屾櫙鍥?
app.post('/api/background/upload', uploadBg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '璇烽€夋嫨鍥剧墖' });

  // 鍒犻櫎鏃ц儗鏅?
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

// 鏇存柊鑳屾櫙璁剧疆(浣嶇疆/缂╂斁)
app.put('/api/background', express.json(), (req, res) => {
  const { position, scale } = req.body;
  if (position) bgConfig.position = position;
  if (scale) bgConfig.scale = scale;
  saveData(BG_FILE, bgConfig);

  io.emit('background:update', bgConfig);

  res.json({ success: true, background: bgConfig });
});

// ===== API: 瑙嗛绠＄悊 =====

// 鑾峰彇瑙嗛鍒楄〃
app.get('/api/videos', (req, res) => {
  res.json(videos);
});

// 鑾峰彇瑙嗛鎾斁閰嶇疆
app.get('/api/videos/config', (req, res) => {
  res.json({
    interval: videoConfig.interval,
    repeat: videoConfig.repeat,
    enabled: videos.length > 0
  });
});

// 涓婁紶瑙嗛
app.post('/api/videos/upload', uploadVideo.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '璇烽€夋嫨瑙嗛' });

  const { name, date } = req.body;
  const video = {
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    name: name || '绮惧僵鍥為【',
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

// 鍒犻櫎瑙嗛
app.delete('/api/videos/:id', (req, res) => {
  const { id } = req.params;
  const idx = videos.findIndex(v => v.id === id);
  if (idx === -1) return res.status(404).json({ error: '瑙嗛涓嶅瓨鍦? });

  const video = videos[idx];
  const filePath = path.join(VIDEOS_DIR, video.filename);

  videos.splice(idx, 1);
  saveData(VIDEOS_FILE, videos);
  io.emit('videos:update', videos);

  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { console.error('鍒犻櫎瑙嗛鏂囦欢澶辫触:', e); }
  }

  res.json({ success: true });
});

// 鏇存柊瑙嗛鎾斁閰嶇疆
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
// 閲嶆柊鐢熸垚鎵€鏈変綔鍝侀〉 + 閮ㄧ讲 PageFire
app.post('/api/regenerate-pages', (req, res) => {
  generateAllWorkPages();
  schedulePagefireDeploy();
  res.json({ success: true, message: '鎵€鏈変綔鍝侀〉宸查噸鏂扮敓鎴?PageFire 閮ㄧ讲灏嗗湪15绉掑唴寮€濮? });
});

io.on('connection', (socket) => {
  console.log(`瀹㈡埛绔凡杩炴帴: ${socket.id}`);
  // 灞曠ず椤靛彧鎺ㄩ€佸湪鏋朵綔鍝?绠＄悊椤电敤 /api/artworks/all 鑾峰彇鍏ㄩ儴
  socket.emit('sync', { artworks: artworks.filter(a => a.status === 'active'), background: bgConfig, videos });

  // 杩借釜灞曠ず椤垫祻瑙?
  socket.on('display:connected', () => { trackDisplayView(); });

  socket.on('disconnect', () => console.log(`瀹㈡埛绔柇寮€: ${socket.id}`));
});

// ===== 鍏ㄥ眬閿欒澶勭悊(蹇呴』鍦ㄦ墍鏈夎矾鐢变箣鍚?=====
app.use(multerErrorHandler);

// ===== 鍚姩 =====
// 鐢熸垚鎵€鏈夊凡鏈変綔鍝佺殑闈欐€侀〉
generateAllWorkPages();

server.listen(PORT, () => {
  // 鑷姩鑾峰彇灞€鍩熺綉 IP
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
  console.log('鈺斺晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晽');
  console.log('鈺?    鏁︾厡AIGC鑹烘湳灞曡 路 鎶曞睆灞曠ず绯荤粺宸插惎鍔?     鈺?);
  console.log('鈺犫晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暎');
  console.log(`鈺? 灞曠ず椤?鐢佃澶у睆):                              鈺慲);
  console.log(`鈺?   http://localhost:${PORT}/display              鈺慲);
  console.log(`鈺? 绠＄悊椤?鍚庡彴鎿嶄綔):                              鈺慲);
  console.log(`鈺?   http://localhost:${PORT}/admin                鈺慲);
  console.log('鈺犫晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暎');
  console.log(`鈺? 鎵嬫満绔綔鍝侀〉(鍚學iFi鎵爜璁块棶):                  鈺慲);
  console.log(`鈺?   http://${lanIP}:${PORT}/work/{浣滃搧ID}       `.padEnd(51) + '鈺?);
  console.log('鈺氣晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暆');
  console.log('');
});




