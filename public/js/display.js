/**
 * 展示页浮动气泡引擎 v4
 * - 固定6张卡片始终在屏幕上，均匀分布
 * - 每张卡片展示10~20秒后淡出，立即换下一张
 * - 新作品到达时触发高光特写流程
 * - 全屏视频定时插播（不打断，新作品排队等待）
 */

// ===== 全局状态 =====
let allArtworks = [];
let activeCards = [];
let nextIndex = 0;
const FIXED_CARDS = 6;
const MIN_LIFETIME = 10000;
const MAX_LIFETIME = 20000;

let lastTime = 0;
let screenW = window.innerWidth;
let screenH = window.innerHeight;
let galleryPaused = false; // 视频插播时暂停画廊

// ===== 视频插播状态 =====
let videos = [];
let videoConfig = { interval: 300, repeat: 2, enabled: false };
let videoTimer = null;
let videoSafetyTimer = null;
let videoPlayCount = 0;
let videoPlayTarget = 2;

// ===== Spotlight 状态 =====
let spotlightQueue = [];
let isSpotlightRunning = false;
let videoEndCallback = null;
let sparkleInterval = null;
let spotlightSize = 500;      // 动态设置：60%屏幕高度
let isPostVideoProcessing = false; // 视频结束后集中处理spotlight

// ===== DOM =====
const canvas = document.getElementById('canvas');
const bgLayer = document.getElementById('background-layer');
const emptyHint = document.getElementById('empty-hint');
const videoOverlay = document.getElementById('video-overlay');
const showcaseVideo = document.getElementById('showcase-video');

const spotlightLayer = document.getElementById('spotlight-layer');
const spotlightWrap = document.getElementById('spotlight-image-wrap');
const originalLayer = document.getElementById('original-layer');
const mattedLayer = document.getElementById('matted-layer');
const originalImg = document.getElementById('original-img');
const mattedImg = document.getElementById('matted-img');
const lightRays = document.getElementById('light-rays');
const lightRing = document.getElementById('light-ring');
const flashOverlay = document.getElementById('flash-overlay');
const spotlightInfo = document.getElementById('spotlight-info');
const spotName = document.getElementById('spot-name');
const spotDate = document.getElementById('spot-date');
const aurora = document.getElementById('aurora');
const announceText = document.getElementById('announce-text');
const queueIndicator = document.getElementById('queue-indicator');

// ===== 粒子系统 =====
const pCanvas = document.getElementById('particle-canvas');
const pCtx = pCanvas.getContext('2d');
let particles = [];

function resizeParticleCanvas() {
  pCanvas.width = window.innerWidth;
  pCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeParticleCanvas);
resizeParticleCanvas();

class Particle {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.vx = opts.vx ?? (Math.random() - 0.5) * 8;
    this.vy = opts.vy ?? (Math.random() - 0.5) * 8;
    this.size = opts.size ?? (2 + Math.random() * 4);
    this.life = opts.life ?? 1.0;
    this.decay = opts.decay ?? 0.008;
    this.color = opts.color ?? '255,215,0';
    this.gravity = opts.gravity ?? 0;
    this.shrink = opts.shrink ?? 0.99;
    this.twinkle = opts.twinkle ?? false;
    this.twinklePhase = Math.random() * Math.PI * 2;
    this.twinkleSpeed = 0.05 + Math.random() * 0.1;
  }
  update(dt) {
    this.x += this.vx * dt * 0.06;
    this.y += this.vy * dt * 0.06;
    this.vy += this.gravity * dt * 0.06;
    this.vx *= 0.985;
    this.vy *= 0.985;
    this.size *= this.shrink;
    this.life -= this.decay * dt * 0.06;
    if (this.twinkle) this.twinklePhase += this.twinkleSpeed * dt * 0.06;
  }
  draw(ctx) {
    if (this.life <= 0 || this.size < 0.5) return;
    const alpha = this.twinkle ? this.life * (0.5 + 0.5 * Math.sin(this.twinklePhase)) : this.life;
    const r = Math.max(0.5, this.size);
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 3);
    grad.addColorStop(0, `rgba(${this.color},${alpha})`);
    grad.addColorStop(0.3, `rgba(${this.color},${alpha * 0.5})`);
    grad.addColorStop(1, `rgba(${this.color},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,240,${alpha * 0.9})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function burstParticles(x, y, count, opts = {}) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const speed = (opts.minSpeed ?? 3) + Math.random() * (opts.maxSpeed ?? 8);
    particles.push(new Particle(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: (opts.minSize ?? 2) + Math.random() * (opts.maxSize ?? 5),
      life: 1.0,
      decay: opts.decay ?? 0.01,
      color: opts.color ?? '255,215,0',
      gravity: opts.gravity ?? 0.05,
      shrink: 0.995,
      twinkle: true,
    }));
  }
}

function spawnFloatingSparkles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 150 + Math.random() * 200;
    particles.push(new Particle(
      x + Math.cos(angle) * dist,
      y + Math.sin(angle) * dist,
      {
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.2 - Math.random() * 0.5,
        size: 1.5 + Math.random() * 2.5,
        life: 1.0,
        decay: 0.004,
        color: Math.random() > 0.3 ? '255,215,0' : '255,180,40',
        gravity: -0.02,
        shrink: 0.998,
        twinkle: true,
      }
    ));
  }
}

function trailParticles(x, y, count) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(
      x + (Math.random() - 0.5) * 40,
      y + (Math.random() - 0.5) * 40,
      {
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5 - 0.5,
        size: 2 + Math.random() * 3,
        life: 0.8,
        decay: 0.015,
        color: '255,215,0',
        gravity: 0.02,
        shrink: 0.99,
        twinkle: true,
      }
    ));
  }
}

let pLastFrame = 0;
function particleLoop(t) {
  if (!pLastFrame) pLastFrame = t;
  const dt = Math.min(t - pLastFrame, 50);
  pLastFrame = t;
  pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(dt);
    particles[i].draw(pCtx);
    if (particles[i].life <= 0 || particles[i].size < 0.5) particles.splice(i, 1);
  }
  requestAnimationFrame(particleLoop);
}
requestAnimationFrame(particleLoop);

// ===== Socket.io =====
const socket = io();

socket.on('connect', () => {
  console.log('展示页已连接');
  socket.emit('display:connected');
});

socket.on('sync', (data) => {
  allArtworks = data.artworks || [];
  videos = data.videos || [];
  applyBackground(data.background);

  // 重连/初始化时彻底清理所有运行状态，防止卡死
  clearTimeout(videoTimer);
  clearTimeout(videoSafetyTimer);
  videoTimer = null;
  videoSafetyTimer = null;
  galleryPaused = false;
  isSpotlightRunning = false;
  isPostVideoProcessing = false;
  spotlightQueue = [];
  videoEndCallback = null;
  stopSparkles();

  // 隐藏可能残留的 spotlight / video 层
  spotlightLayer.classList.remove('active');
  aurora.classList.remove('active');
  canvas.classList.remove('dimmed');
  spotlightInfo.classList.remove('show');
  announceText.classList.remove('show');
  queueIndicator.classList.remove('show');
  videoOverlay.classList.remove('active', 'hidden');
  showcaseVideo.pause();
  showcaseVideo.removeAttribute('src');
  showcaseVideo.load();
  document.getElementById('title-bar').style.opacity = '';
  canvas.style.opacity = '';

  resetDisplay();
  restartVideoSchedule();
});

// 新作品到达 → 触发 spotlight
socket.on('artwork:new', (artwork) => {
  allArtworks.push(artwork);
  emptyHint.classList.add('hidden');

  // 有 originalUrl 才走 spotlight，否则直接补卡片
  if (artwork.originalUrl && artwork.originalUrl !== artwork.url) {
    spotlightQueue.push(artwork);
    processSpotlightQueue();
  } else {
    fillCards();
  }
});

socket.on('artworks:batch', (artworks) => {
  artworks.forEach(a => allArtworks.push(a));
  if (allArtworks.length > 0) emptyHint.classList.add('hidden');
  fillCards();
});

// 下架(归档)
socket.on('artwork:archive', ({ id }) => {
  allArtworks = allArtworks.filter(a => a.id !== id);
  activeCards.forEach(c => {
    if (c.artwork.id === id) c.startFadeOut();
  });
  if (allArtworks.length === 0) emptyHint.classList.remove('hidden');
});

socket.on('artwork:purge', ({ id }) => {
  allArtworks = allArtworks.filter(a => a.id !== id);
  activeCards.forEach(c => {
    if (c.artwork.id === id) c.startFadeOut();
  });
  if (allArtworks.length === 0) emptyHint.classList.remove('hidden');
});

socket.on('artwork:restore', ({ id, artwork }) => {
  if (!allArtworks.find(a => a.id === id)) {
    allArtworks.push(artwork);
    emptyHint.classList.add('hidden');
    fillCards();
  }
});

socket.on('background:update', (bg) => applyBackground(bg));

socket.on('videos:update', (list) => {
  videos = list;
  if (list.length === 0) {
    clearTimeout(videoTimer);
    videoTimer = null;
  }
  restartVideoSchedule();
});

socket.on('videos:config', (cfg) => {
  videoConfig = cfg;
  restartVideoSchedule();
});

// ===== 视频插播引擎 =====
function restartVideoSchedule() {
  clearTimeout(videoTimer);
  videoTimer = null;
  if (videos.length === 0) return;
  fetch('/api/videos/config').then(r => r.json()).then(cfg => {
    videoConfig = cfg;
    scheduleNextVideo();
  }).catch(() => {
    scheduleNextVideo();
  });
}

function scheduleNextVideo() {
  if (videos.length === 0) return;
  const intervalMs = (videoConfig.interval || 300) * 1000;
  videoTimer = setTimeout(playShowcaseVideo, intervalMs);
}

function playShowcaseVideo() {
  if (videos.length === 0) return;
  if (galleryPaused) {
    // 有 spotlight 或其他操作正在进行，延迟 5 秒后重试
    videoTimer = setTimeout(playShowcaseVideo, 5000);
    return;
  }

  const video = videos[0];
  videoPlayCount = 0;
  videoPlayTarget = videoConfig.repeat || 2;
  galleryPaused = true;

  document.getElementById('title-bar').style.opacity = '0';
  canvas.style.opacity = '0';

  showcaseVideo.src = video.url;
  showcaseVideo.muted = true;
  showcaseVideo.playsInline = true;
  showcaseVideo.setAttribute('playsinline', '');
  videoOverlay.classList.remove('hidden');
  setTimeout(() => videoOverlay.classList.add('active'), 50);

  // 安全超时：如果视频卡住或 onended 不触发，最多等 5 分钟自动恢复
  clearTimeout(videoSafetyTimer);
  videoSafetyTimer = setTimeout(() => {
    console.warn('视频播放超时，自动恢复');
    if (galleryPaused) endVideoShowcase();
  }, 300000);

  showcaseVideo.play().catch(e => {
    console.warn('视频自动播放失败:', e);
    // 播放失败也走结束流程，避免卡死
    setTimeout(endVideoShowcase, 2000);
  });

  showcaseVideo.onended = () => {
    videoPlayCount++;
    if (videoPlayCount < videoPlayTarget) {
      showcaseVideo.currentTime = 0;
      showcaseVideo.play().catch(() => {});
    } else {
      endVideoShowcase();
    }
  };

  showcaseVideo.onerror = () => {
    console.warn('视频加载失败');
    setTimeout(endVideoShowcase, 1000);
  };
}

function endVideoShowcase() {
  clearTimeout(videoSafetyTimer);
  videoOverlay.classList.remove('active');
  setTimeout(() => {
    videoOverlay.classList.add('hidden');
    showcaseVideo.pause();
    showcaseVideo.removeAttribute('src');
    showcaseVideo.load();
    galleryPaused = false;

    document.getElementById('title-bar').style.opacity = '';
    canvas.style.opacity = '';

    // 处理 spotlight 队列
    if (videoEndCallback) {
      const cb = videoEndCallback;
      videoEndCallback = null;
      setTimeout(cb, 600);
    } else if (spotlightQueue.length > 0) {
      // 期望B: 视频结束后处理排队中的特写
      queueIndicator.classList.remove('show');
      isPostVideoProcessing = true;
      setTimeout(processSpotlightQueue, 600);
    }

    scheduleNextVideo();
  }, 800);
}

// ===== Spotlight 流程 =====
function processSpotlightQueue() {
  if (isSpotlightRunning) return;
  if (spotlightQueue.length === 0) {
    isPostVideoProcessing = false; // 队列清空，结束集中处理
    return;
  }

  const art = spotlightQueue.shift();

  if (galleryPaused) {
    // 视频正在播放，排队等待
    queueIndicator.classList.add('show');
    videoEndCallback = () => {
      queueIndicator.classList.remove('show');
      startSpotlight(art);
    };
    return;
  }

  // 期望B: 有视频时，等视频结束后再呈现（isPostVideoProcessing为true时不等待）
  if (videos.length > 0 && !isPostVideoProcessing) {
    queueIndicator.classList.add('show');
    spotlightQueue.unshift(art); // 放回队列
    return;
  }

  // 立即开始
  queueIndicator.classList.remove('show');
  startSpotlight(art);
}

function createShockwave(delay) {
  setTimeout(() => {
    const ring = document.createElement('div');
    ring.className = 'shockwave';
    ring.style.animation = 'shockExpand 1.2s cubic-bezier(0.2, 0.6, 0.3, 1) forwards';
    spotlightLayer.appendChild(ring);
    setTimeout(() => ring.remove(), 1300);
  }, delay);
}

function createGlowPulse(delay) {
  setTimeout(() => {
    const pulse = document.createElement('div');
    pulse.className = 'glow-pulse';
    pulse.style.width = '400px';
    pulse.style.height = '400px';
    pulse.style.background = 'radial-gradient(circle, rgba(255,215,0,0.15) 0%, transparent 70%)';
    pulse.style.animation = 'glowPulse 2s ease-out forwards';
    spotlightLayer.appendChild(pulse);
    setTimeout(() => pulse.remove(), 2100);
  }, delay);
}

function startSparkles() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  spawnFloatingSparkles(cx, cy, 8);
  sparkleInterval = setInterval(() => {
    spawnFloatingSparkles(cx, cy, 3);
  }, 600);
}

function stopSparkles() {
  if (sparkleInterval) { clearInterval(sparkleInterval); sparkleInterval = null; }
}

// 自动裁掉图片四周白边/浅色背景，返回裁剪后的 dataURL
function cropWhiteBorders(imgUrl) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      const sw = probe.naturalWidth;
      const sh = probe.naturalHeight;
      // 限制最大处理尺寸（大图也只用缩小版来扫描，够精确）
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(sw, sh));
      const cw = Math.round(sw * scale);
      const ch = Math.round(sh * scale);

      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const cx = c.getContext('2d');
      cx.drawImage(probe, 0, 0, cw, ch);
      const imgData = cx.getImageData(0, 0, cw, ch);
      const d = imgData.data;

      const threshold = 238; // RGB 全部 > 此值 → 视为白
      const step = 3;
      let minX = cw, minY = ch, maxX = -1, maxY = -1;
      let hasContent = false;

      for (let y = 0; y < ch; y += step) {
        for (let x = 0; x < cw; x += step) {
          const i = (y * cw + x) * 4;
          const a = d[i + 3];
          if (a < 10) continue; // 透明像素跳过
          if (d[i] < threshold || d[i + 1] < threshold || d[i + 2] < threshold) {
            hasContent = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (!hasContent) { resolve(imgUrl); return; }

      const pad = Math.round(15 * scale);
      minX = Math.max(0, (minX - pad) / scale);
      minY = Math.max(0, (minY - pad) / scale);
      maxX = Math.min(sw, (maxX + pad + step) / scale);
      maxY = Math.min(sh, (maxY + pad + step) / scale);

      // 如果裁剪面积和原图差异 <5%，不裁
      if ((maxX - minX) > sw * 0.95 && (maxY - minY) > sh * 0.95) {
        resolve(imgUrl);
        return;
      }

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(maxX - minX);
      cropCanvas.height = Math.round(maxY - minY);
      cropCanvas.getContext('2d').drawImage(probe, minX, minY, maxX - minX, maxY - minY, 0, 0, cropCanvas.width, cropCanvas.height);
      resolve(cropCanvas.toDataURL('image/jpeg', 0.92));
    };
    probe.onerror = () => resolve(imgUrl);
    probe.src = imgUrl;
  });
}

function startSpotlight(art) {
  isSpotlightRunning = true;
  galleryPaused = true;

  aurora.classList.add('active');
  canvas.classList.add('dimmed');

  // 预加载抠图
  mattedImg.src = art.url;
  spotName.textContent = art.name;
  spotDate.textContent = art.date;

  // 原图先裁白边再展示
  cropWhiteBorders(art.originalUrl).then(croppedUrl => {
    originalImg.src = croppedUrl;

    // 重置图层
    originalLayer.style.opacity = '1';
    mattedLayer.style.opacity = '0';
    spotlightInfo.classList.remove('show');
    lightRays.classList.remove('active');
    lightRing.classList.remove('active');

    // 计算特写尺寸：占屏幕高度60%
    spotlightSize = Math.round(window.innerHeight * 0.6);
    const offsetX = Math.round((window.innerWidth - spotlightSize) / 2);
    const offsetY = Math.round((window.innerHeight - spotlightSize) / 2);

    // 设置容器尺寸
    spotlightWrap.style.width = spotlightSize + 'px';
    spotlightWrap.style.height = spotlightSize + 'px';

    // 定位到屏幕中心（像素坐标）
    spotlightWrap.style.transition = 'none';
    spotlightWrap.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(0.3)';
    spotlightLayer.classList.add('active');

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    // === Phase 0: 入场爆发 ===
    createShockwave(0);
    createShockwave(150);
    createShockwave(350);

    burstParticles(cx, cy, 50, { minSpeed: 4, maxSpeed: 12, minSize: 3, maxSize: 7, decay: 0.01, gravity: 0.03 });
    burstParticles(cx, cy, 25, { minSpeed: 2, maxSpeed: 6, minSize: 2, maxSize: 4, decay: 0.012, color: '255,200,80', gravity: 0.02 });

    setTimeout(() => announceText.classList.add('show'), 200);

    // 作品弹跳放大
    setTimeout(() => {
      spotlightWrap.style.transition = 'transform 0.9s cubic-bezier(0.34, 1.5, 0.64, 1)';
      spotlightWrap.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(1)';
    }, 50);

    // === Phase 1: 展示原图 + 光效 ===
    setTimeout(() => {
      lightRays.classList.add('active');
      lightRing.classList.add('active');
      createGlowPulse(0);
      createGlowPulse(600);
      createGlowPulse(1200);
      createGlowPulse(1800);
      startSparkles();
      spotlightInfo.classList.add('show');
      announceText.classList.remove('show');

      burstParticles(cx, cy, 20, { minSpeed: 2, maxSpeed: 5, minSize: 2, maxSize: 4, decay: 0.015, gravity: -0.01 });
    }, 900);

    // === Phase 2: 缩小原图到画廊位置（延长3秒）===
    const originalDuration = 5500;
    setTimeout(() => {
      shrinkAndFloat(art);
    }, originalDuration + 900);
  });
}

function shrinkAndFloat(art) {
  // 关闭装饰光效，但保持原图可见
  stopSparkles();
  lightRays.classList.remove('active');
  lightRing.classList.remove('active');

  const targetSize = 200 + Math.random() * 120;
  const pos = findPosition(targetSize, targetSize);

  spotlightInfo.classList.remove('show');

  // 缩小原图到目标位置
  spotlightWrap.style.transition = 'transform 1.3s cubic-bezier(0.4, 0, 0.6, 1)';
  spotlightWrap.style.transform = `translate(${pos.x + targetSize/2 - window.innerWidth/2}px, ${pos.y + targetSize/2 - window.innerHeight/2}px) scale(${targetSize / 500})`;

  // 粒子尾迹
  let trailCount = 0;
  const trailInterval = setInterval(() => {
    const rect = spotlightWrap.getBoundingClientRect();
    trailParticles(rect.left + rect.width/2, rect.top + rect.height/2, 3);
    trailCount++;
    if (trailCount > 8) clearInterval(trailInterval);
  }, 150);

  // 缩小到位后 → 闪光替换为抠图
  setTimeout(() => {
    const destX = pos.x + targetSize / 2;
    const destY = pos.y + targetSize / 2;

    // 闪光爆发
    flashOverlay.style.animation = 'none';
    void flashOverlay.offsetWidth;
    flashOverlay.style.animation = 'flashBurst 0.9s ease-out forwards';

    // 粒子爆发
    burstParticles(destX, destY, 40, { minSpeed: 3, maxSpeed: 10, minSize: 2, maxSize: 5, decay: 0.012, gravity: 0.02 });
    burstParticles(destX, destY, 20, { minSpeed: 1, maxSpeed: 4, minSize: 1, maxSize: 3, decay: 0.018, color: '255,255,240' });

    // Crossfade：原图 → 抠图
    originalLayer.style.opacity = '0';
    mattedLayer.style.opacity = '1';

    createGlowPulse(0);

    // 替换完成后，成为浮动卡片
    setTimeout(() => {
      finishSpotlight(art, pos, targetSize);
    }, 700);
  }, 1350);
}

function finishSpotlight(art, pos, targetSize) {
  const destX = pos.x + targetSize / 2;
  const destY = pos.y + targetSize / 2;
  burstParticles(destX, destY, 10, { minSpeed: 1, maxSpeed: 3, minSize: 2, maxSize: 3, decay: 0.025, gravity: 0.03 });

  // 在缩小终点创建浮动卡片（而不是随机位置）
  const card = new FloatingCard(art);
  card.x = pos.x;
  card.y = pos.y;
  card.width = targetSize;
  card.height = targetSize;
  card.opacity = 1;
  card.state = 'visible';
  card.el.style.width = targetSize + 'px';
  card.el.style.height = targetSize + 'px';
  card.el.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px)';
  card.el.style.opacity = '1';

  // 图片加载后保持位置，不触发碰撞重定位
  const img = card.el.querySelector('img');
  img.addEventListener('load', function() {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw > 0 && nh > 0) {
      card.height = card.width * (nh / nw);
      card.el.style.height = card.height + 'px';
    }
  });

  activeCards.push(card);

  spotlightLayer.classList.remove('active');
  aurora.classList.remove('active');
  canvas.classList.remove('dimmed');
  galleryPaused = false;

  isSpotlightRunning = false;

  // 处理队列中的下一个
  setTimeout(processSpotlightQueue, 500);
}

// ===== 背景 =====
function applyBackground(bg) {
  if (!bg || !bg.url) return;
  bgLayer.style.backgroundImage = `url('${bg.url}')`;
  bgLayer.style.backgroundSize = bg.scale || 'cover';
  bgLayer.style.backgroundPosition = bg.position || 'center';
}

// ===== 重置展示 =====
function resetDisplay() {
  activeCards.forEach(c => c.destroy());
  activeCards = [];
  nextIndex = 0;

  if (allArtworks.length === 0) {
    emptyHint.classList.remove('hidden');
    return;
  }
  emptyHint.classList.add('hidden');
  for (let i = 0; i < FIXED_CARDS; i++) {
    const artwork = getNextArtwork();
    if (!artwork) break;
    spawnCard(artwork);
  }
}

function getNextArtwork() {
  if (allArtworks.length === 0) return null;
  const total = allArtworks.length;
  const artwork = allArtworks[nextIndex % total];
  nextIndex = (nextIndex + 1) % total;
  return artwork;
}

function fillCards() {
  if (allArtworks.length === 0) return;
  if (galleryPaused) return;
  emptyHint.classList.add('hidden');

  const alive = activeCards.filter(c => c.state !== 'fadeOut');
  const needed = FIXED_CARDS - alive.length;
  for (let i = 0; i < needed; i++) {
    const artwork = getNextArtwork();
    if (!artwork) break;
    spawnCard(artwork);
  }
}

// ===== 碰撞检测 =====
const PAD = 30;
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return !(
    ax + aw + PAD < bx ||
    bx + bw + PAD < ax ||
    ay + ah + PAD < by ||
    by + bh + PAD < ay
  );
}

function isOverlappingWithActive(x, y, w, h, excludeCard) {
  for (const card of activeCards) {
    if (card === excludeCard) continue;
    if (card.state === 'fadeOut') continue;
    if (rectsOverlap(x, y, w, h, card.x, card.y, card.width, card.height)) {
      return true;
    }
  }
  return false;
}

function findPosition(w, h) {
  const margin = 15;
  const top = 80, bot = 20;
  for (let i = 0; i < 50; i++) {
    const x = margin + Math.random() * (screenW - w - margin * 2);
    const y = top + Math.random() * (screenH - h - top - bot);
    if (!isOverlappingWithActive(x, y, w, h)) return { x, y };
  }
  const cols = Math.floor((screenW - margin * 2) / (w + PAD));
  const rows = Math.floor((screenH - top - bot) / (h + PAD));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + c * (w + PAD);
      const y = top + r * (h + PAD);
      if (!isOverlappingWithActive(x, y, w, h)) return { x, y };
    }
  }
  return { x: margin + Math.random() * (screenW - w - margin * 2),
           y: top + Math.random() * (screenH - h - top - bot) };
}

// ===== 浮动卡片 =====
class FloatingCard {
  constructor(artwork) {
    this.artwork = artwork;
    this.id = artwork.id + '_' + Math.random().toString(36).slice(2, 6);

    this.depth = 0.35 + Math.random() * 0.65;
    this.width = 200 + this.depth * 120;
    this.height = this.width;

    const pos = findPosition(this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;

    const speed = 0.10 + this.depth * 0.20;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    this.rotation = (Math.random() - 0.5) * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.02;

    this.bobPhase = Math.random() * Math.PI * 2;
    this.bobAmplitude = 3 + Math.random() * 5;
    this.bobSpeed = 0.005 + Math.random() * 0.007;

    this.lifetime = MIN_LIFETIME + Math.random() * (MAX_LIFETIME - MIN_LIFETIME);
    this.age = 0;
    this.opacity = 0;
    this.targetOpacity = 0.92;
    this.state = 'fadeIn';

    this._removed = false;
    this.createDOM();
  }

  createDOM() {
    this.el = document.createElement('div');
    this.el.className = 'floating-card';
    this.el.style.width = this.width + 'px';
    this.el.style.height = this.height + 'px';
    this.el.style.opacity = '0';
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    this.el.innerHTML = `
      <div class="card-image">
        <img src="${this.artwork.url}" alt="${this.artwork.name}" loading="lazy">
        <div class="card-overlay">
          <div class="card-name">${escapeHtml(this.artwork.name)}</div>
          <div class="card-date">${escapeHtml(this.artwork.date)}</div>
        </div>
      </div>`;
    canvas.appendChild(this.el);

    const img = this.el.querySelector('img');
    img.addEventListener('load', () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (nw > 0 && nh > 0) {
        this.height = this.width * (nh / nw);
        this.el.style.height = this.height + 'px';
        if (isOverlappingWithActive(this.x, this.y, this.width, this.height, this)) {
          const pos = findPosition(this.width, this.height);
          this.x = pos.x;
          this.y = pos.y;
        }
      }
    });
  }

  update(dt) {
    if (this._removed) return false;
    if (galleryPaused) return true;
    this.age += dt;

    this.x += this.vx * (dt / 16);
    this.y += this.vy * (dt / 16);

    this.bobPhase += this.bobSpeed * (dt / 16);
    const bobY = Math.sin(this.bobPhase) * this.bobAmplitude;

    this.rotation += this.rotationSpeed * (dt / 16);

    const m = 10, t = 70;
    if (this.x < m) { this.x = m; this.vx = Math.abs(this.vx); }
    if (this.x + this.width > screenW - m) { this.x = screenW - this.width - m; this.vx = -Math.abs(this.vx); }
    if (this.y < t) { this.y = t; this.vy = Math.abs(this.vy); }
    if (this.y + this.height > screenH - m) { this.y = screenH - this.height - m; this.vy = -Math.abs(this.vy); }

    if (this.state === 'fadeIn') {
      this.opacity += 0.025 * (dt / 16);
      if (this.opacity >= this.targetOpacity) {
        this.opacity = this.targetOpacity;
        this.state = 'visible';
      }
    } else if (this.state === 'visible') {
      if (this.age >= this.lifetime) this.state = 'fadeOut';
    } else if (this.state === 'fadeOut') {
      this.opacity -= 0.025 * (dt / 16);
      if (this.opacity <= 0) {
        this._removed = true;
        return false;
      }
    }

    this.el.style.transform = `translate(${this.x}px, ${this.y + bobY}px) rotate(${this.rotation}deg)`;
    this.el.style.opacity = this.opacity;
    this.el.style.zIndex = Math.floor(this.depth * 100);
    return true;
  }

  startFadeOut() { if (this.state !== 'fadeOut') this.state = 'fadeOut'; }

  destroy() {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this._removed = true;
  }
}

function spawnCard(artwork) {
  const card = new FloatingCard(artwork);
  activeCards.push(card);
  return card;
}

function resolveCollisions() {
  if (galleryPaused) return;
  for (let i = 0; i < activeCards.length; i++) {
    const a = activeCards[i];
    if (a.state === 'fadeOut' || a._removed) continue;
    for (let j = i + 1; j < activeCards.length; j++) {
      const b = activeCards[j];
      if (b.state === 'fadeOut' || b._removed) continue;
      if (rectsOverlap(a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height)) {
        const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
        const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = 0.5;
        a.x += (dx / dist) * f;
        a.y += (dy / dist) * f;
        b.x -= (dx / dist) * f;
        b.y -= (dy / dist) * f;
        const nx = dx / dist, ny = dy / dist;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) {
          a.vx -= rel * nx * 0.8;
          a.vy -= rel * ny * 0.8;
          b.vx += rel * nx * 0.8;
          b.vy += rel * ny * 0.8;
        }
      }
    }
  }
}

function animate(time) {
  if (!lastTime) lastTime = time;
  const dt = Math.min(time - lastTime, 50);
  lastTime = time;

  if (!galleryPaused) {
    const prevCount = activeCards.length;
    activeCards = activeCards.filter(card => {
      const alive = card.update(dt);
      if (!alive) card.destroy();
      return alive;
    });

    if (activeCards.length < prevCount) {
      fillCards();
    }

    resolveCollisions();

    if (allArtworks.length === 0 && activeCards.length === 0) {
      emptyHint.classList.remove('hidden');
    }
  }

  requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
  screenW = window.innerWidth;
  screenH = window.innerHeight;
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

requestAnimationFrame(animate);

document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  }
});
