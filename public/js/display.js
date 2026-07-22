/**
 * 展示页浮动气泡引擎 v3
 * - 固定6张卡片始终在屏幕上，均匀分布
 * - 每张卡片展示10~20秒后淡出，立即换下一张
 * - 帧级碰撞检测，互不遮盖
 * - 全屏视频定时插播（重复2次后回到画廊）
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
let videoPlayCount = 0;
let videoPlayTarget = 2;

// ===== DOM =====
const canvas = document.getElementById('canvas');
const bgLayer = document.getElementById('background-layer');
const emptyHint = document.getElementById('empty-hint');
const videoOverlay = document.getElementById('video-overlay');
const showcaseVideo = document.getElementById('showcase-video');

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
  resetDisplay();
  restartVideoSchedule();
});

socket.on('artwork:new', (artwork) => {
  allArtworks.push(artwork);
  emptyHint.classList.add('hidden');
  fillCards();
});

socket.on('artworks:batch', (artworks) => {
  artworks.forEach(a => allArtworks.push(a));
  if (allArtworks.length > 0) emptyHint.classList.add('hidden');
  fillCards();
});

socket.on('artwork:delete', ({ id }) => {
  allArtworks = allArtworks.filter(a => a.id !== id);
  activeCards.forEach(c => {
    if (c.artwork.id === id) c.startFadeOut();
  });
  if (allArtworks.length === 0) emptyHint.classList.remove('hidden');
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
  if (galleryPaused) return; // 已经在播视频

  const video = videos[0]; // 目前只播第一个
  videoPlayCount = 0;
  videoPlayTarget = videoConfig.repeat || 2;
  galleryPaused = true;

  // 隐藏画廊元素
  document.getElementById('title-bar').style.opacity = '0';
  canvas.style.opacity = '0';

  // 显示视频覆盖层
  showcaseVideo.src = video.url;
  showcaseVideo.muted = true;
  showcaseVideo.playsInline = true;
  showcaseVideo.setAttribute('playsinline', '');
  videoOverlay.classList.remove('hidden');
  setTimeout(() => videoOverlay.classList.add('active'), 50);

  showcaseVideo.play().catch(e => console.warn('视频自动播放失败:', e));

  showcaseVideo.onended = () => {
    videoPlayCount++;
    if (videoPlayCount < videoPlayTarget) {
      // 再播一次
      showcaseVideo.currentTime = 0;
      showcaseVideo.play().catch(() => {});
    } else {
      // 播完了，回到画廊
      endVideoShowcase();
    }
  };
}

function endVideoShowcase() {
  videoOverlay.classList.remove('active');
  setTimeout(() => {
    videoOverlay.classList.add('hidden');
    showcaseVideo.pause();
    showcaseVideo.removeAttribute('src');
    showcaseVideo.load();
    galleryPaused = false;

    // 恢复画廊
    document.getElementById('title-bar').style.opacity = '';
    canvas.style.opacity = '';

    // 安排下一次插播
    scheduleNextVideo();
  }, 800);
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
    // 立即设置初始透明和位置，防止首帧闪烁
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
    if (galleryPaused) return true; // 视频播放时冻结
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
