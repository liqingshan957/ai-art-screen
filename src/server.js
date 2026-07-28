const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const REMBG_HOST = process.env.REMBG_HOST || 'localhost';
const REMBG_PORT = parseInt(process.env.REMBG_PORT || '7000');
const REMBG_TIMEOUT = 15000;
const DEDUP_WINDOW = 30000;

const ROOT_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT_DIR, 'web');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const ARTWORKS_DIR = path.join(UPLOADS_DIR, 'artworks');
const ORIGINALS_DIR = path.join(UPLOADS_DIR, 'originals');
const BG_DIR = path.join(UPLOADS_DIR, 'background');
const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const TEMPLATES_DIR = path.join(ROOT_DIR, 'templates');
const WEB_WORKS_DIR = path.join(WEB_DIR, 'works');
const PAGEFIRE_DIR = path.join(ROOT_DIR, 'deploy', 'pagefire');
const PAGEFIRE_WORKS_DIR = path.join(PAGEFIRE_DIR, 'works');
const PAGEFIRE_ARTWORKS_DIR = path.join(PAGEFIRE_DIR, 'artworks');

[UPLOADS_DIR, ARTWORKS_DIR, ORIGINALS_DIR, BG_DIR, VIDEOS_DIR, WEB_WORKS_DIR, DATA_DIR, PAGEFIRE_DIR, PAGEFIRE_WORKS_DIR, PAGEFIRE_ARTWORKS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const ARTWORKS_FILE = path.join(DATA_DIR, 'artworks.json');
const BG_FILE = path.join(DATA_DIR, 'background.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const VIDEOS_CONFIG_FILE = path.join(DATA_DIR, 'videos_config.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const DASHBOARD_FILE = path.join(DATA_DIR, 'dashboard.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'artworks_archive.json');

function loadJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('Read data failed:', file, e.message); }
  return fallback;
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

let artworks = loadJSON(ARTWORKS_FILE, []);
let bgConfig = loadJSON(BG_FILE, { filename: null, position: 'center', scale: 'cover' });
let videos = loadJSON(VIDEOS_FILE, []);
let videoConfig = loadJSON(VIDEOS_CONFIG_FILE, { interval: 300, repeat: 2 });
let analytics = loadJSON(ANALYTICS_FILE, {});
let dashboardData = loadJSON(DASHBOARD_FILE, {});
let archive = loadJSON(ARCHIVE_FILE, []);
artworks = artworks.map(a => ({ ...a, status: a.status || 'active' }));

// Template engine
let workPageTemplate = '', pagefirePageTemplate = '';
try {
  workPageTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'work-page.html'), 'utf8');
  pagefirePageTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'pagefire-page.html'), 'utf8');
} catch (e) { console.error('Failed to load templates:', e.message); }

function renderTemplate(tpl, data) {
  let h = tpl;
  for (const [k, v] of Object.entries(data)) h = h.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), String(v));
  return h;
}
function formatDate(d) { return d && d.length >= 8 ? d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8) : ''; }
function generateWorkPage(a) {
  const html = renderTemplate(workPageTemplate, { NAME: a.name, SAFE_NAME: a.name.replace(/"/g,'\\"'), URL: a.url, DISPLAY_DATE: formatDate(a.date) });
  fs.writeFileSync(path.join(WEB_WORKS_DIR, a.id+'.html'), html, 'utf8');
}
function generatePagefireWorkPage(a) {
  const cdn = (global.__cdnMap&&global.__cdnMap[a.id])||'';
  const url = cdn||(PAGEFIRE_BASE_URL+'/artworks/'+a.id+'.png');
  const html = renderTemplate(pagefirePageTemplate, { NAME: a.name, URL: url, DISPLAY_DATE: formatDate(a.date) });
  fs.writeFileSync(path.join(PAGEFIRE_WORKS_DIR, a.id+'.html'), html, 'utf8');
}
function generateAllWorkPages() {
  artworks.forEach(a => {
    generateWorkPage(a); generatePagefireWorkPage(a);
    if (!fs.existsSync(path.join(PAGEFIRE_ARTWORKS_DIR, a.id+'.png'))) compressForPagefire(a);
  });
}

// Analytics
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

// Multer
const artworkStorage=multer.diskStorage({destination:(r,f,cb)=>cb(null,ARTWORKS_DIR),filename:(r,f,cb)=>{const id=crypto.randomBytes(8).toString('hex');cb(null,id+path.extname(f.originalname).toLowerCase());}});
const bgStorage=multer.diskStorage({destination:(r,f,cb)=>cb(null,BG_DIR),filename:(r,f,cb)=>cb(null,'background'+path.extname(f.originalname).toLowerCase())});
const videoStorage=multer.diskStorage({destination:(r,f,cb)=>cb(null,VIDEOS_DIR),filename:(r,f,cb)=>{const id=crypto.randomBytes(8).toString('hex');cb(null,id+path.extname(f.originalname).toLowerCase());}});
const imageFilter=(r,f,cb)=>{const a=['.jpg','.jpeg','.png','.webp','.gif','.bmp'];const e=path.extname(f.originalname).toLowerCase();cb(a.includes(e)?null:new Error('Images only'),a.includes(e));};
const videoFilter=(r,f,cb)=>{const a=['.mp4','.webm','.avi','.mov','.mkv'];const e=path.extname(f.originalname).toLowerCase();cb(a.includes(e)?null:new Error('Videos only'),a.includes(e));};
const uploadArtwork=multer({storage:artworkStorage,fileFilter:imageFilter,limits:{fileSize:20*1024*1024}});
const uploadBg=multer({storage:bgStorage,fileFilter:imageFilter,limits:{fileSize:30*1024*1024}});
const uploadVideo=multer({storage:videoStorage,fileFilter:videoFilter,limits:{fileSize:500*1024*1024}});

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

const PAGEFIRE_BASE_URL='https://17xskjdaxiang-daxiang.pagefire.openhkt.com';
let pagefireDeployTimer=null;
function schedulePagefireDeploy(){
  if(pagefireDeployTimer)clearTimeout(pagefireDeployTimer);
  pagefireDeployTimer=setTimeout(()=>{
    console.log('Auto deploying PageFire...');
    exec('npx pagefire deploy --dir ../deploy/pagefire',{cwd:__dirname},(err,stdout,stderr)=>{
      if(err)console.error('PageFire deploy failed:',err.message);
      else console.log('PageFire deploy done:',stdout.slice(0,200));
    });
  },15000);
}
function calcCrop(m){return{left:Math.round(m.width*8/102),top:Math.round(m.height*8/152),width:Math.round(m.width*(102-8-8)/102),height:Math.round(m.height*(152-8-32)/152)};}
function compressForPagefire(a){
  try{
    const p=[];let u=false;
    for(const e of['.png','.jpg','.jpeg']){const s=path.join(ORIGINALS_DIR,a.id+e);if(fs.existsSync(s)){(async()=>{try{const m=await sharp(s).metadata(),c=calcCrop(m);p.push(sharp(s).extract(c).png().toFile(path.join(PAGEFIRE_ARTWORKS_DIR,a.id+'.png')));p.push(sharp(s).extract(c).jpeg({quality:92}).toFile(path.join(PAGEFIRE_ARTWORKS_DIR,a.id+'.jpg')));}catch(e){console.error('PageFire crop failed:',a.id,e.message);}})();u=true;break;}}
    if(!u){const s=path.join(ARTWORKS_DIR,a.filename);if(fs.existsSync(s)){p.push(sharp(s).png().toFile(path.join(PAGEFIRE_ARTWORKS_DIR,a.id+'.png')));p.push(sharp(s).jpeg({quality:92}).toFile(path.join(PAGEFIRE_ARTWORKS_DIR,a.id+'.jpg')));}}
    for(const e of['.png','.jpg','.jpeg']){const s=path.join(ORIGINALS_DIR,a.id+'_c'+e);if(fs.existsSync(s)){p.push(sharp(s).jpeg({quality:92}).toFile(path.join(PAGEFIRE_ARTWORKS_DIR,a.id+'_c.jpg')));break;}}
    Promise.all(p).catch(e=>console.error('PageFire convert:',e.message));
    (async()=>{
      try{let s=null;for(const e of['.png','.jpg','.jpeg']){const p2=path.join(ORIGINALS_DIR,a.id+'_c'+e);if(fs.existsSync(p2)){s=p2;break;}}if(!s){const p2=path.join(ARTWORKS_DIR,a.filename);if(fs.existsSync(p2))s=p2;}if(!s)return;
        const FormData=require('form-data'),form=new FormData();form.append('file',fs.createReadStream(s));form.append('mode','compress');form.append('quality','0.92');
        const resp=await fetch('https://vapi.hkting.com/api/open-api/v1/files/upload',{method:'POST',headers:{'X-Api-Key':'ak_CgQovFi4LpzbHqjnsrmnL1albkGaJt5oTqyKfLSz'},body:form});
        const d=await resp.json();if(d.code===0&&d.data&&d.data.url){if(!global.__cdnMap)global.__cdnMap={};global.__cdnMap[a.id]=d.data.url;console.log('CDN:',a.id,d.data.url.slice(0,50));}
      }catch(e){console.error('CDN failed:',a.id,e.message);}
    })();
  }catch(e){console.error('PageFire sync:',e.message);}
}

app.use(express.static(WEB_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/display',(req,res)=>res.sendFile(path.join(WEB_DIR,'display.html')));
app.get('/admin',(req,res)=>res.sendFile(path.join(WEB_DIR,'admin.html')));
app.get('/dashboard',(req,res)=>res.sendFile(path.join(WEB_DIR,'dashboard.html')));
app.get('/',(req,res)=>res.redirect('/admin'));

app.get('/work/:id',(req,res)=>{
  const a=artworks.find(x=>x.id===req.params.id);
  if(!a)return res.status(404).send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#999;font-size:18px}</style></head><body>Artwork not found</body></html>');
  track('pageViews',getClientIP(req));
  res.send(renderTemplate(workPageTemplate,{NAME:a.name,SAFE_NAME:a.name.replace(/"/g,'\\"'),URL:a.url,DISPLAY_DATE:formatDate(a.date)}));
});

app.get('/api/artworks',(req,res)=>res.json(artworks.filter(a=>a.status==='active')));
app.get('/api/artworks/all',(req,res)=>res.json(artworks));
app.get('/api/artworks/stats',(req,res)=>{const a=artworks.filter(x=>x.status==='active').length,b=artworks.filter(x=>x.status==='archived').length;res.json({total:artworks.length,active:a,archived:b});});

app.post('/api/artworks/upload',uploadArtwork.single('image'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Please select image'});
  const a={id:path.basename(req.file.filename,path.extname(req.file.filename)),name:req.body.name||'Anonymous',date:req.body.date||new Date().toISOString().slice(0,10).replace(/-/g,''),filename:req.file.filename,url:'/uploads/artworks/'+req.file.filename,status:'active',createdAt:Date.now()};
  artworks.push(a);saveJSON(ARTWORKS_FILE,artworks);track('newArtworks');generateWorkPage(a);compressForPagefire(a);schedulePagefireDeploy();io.emit('artwork:new',a);
  res.json({success:true,artwork:a});
});

app.post('/api/artworks/batch',uploadArtwork.array('images',50),(req,res)=>{
  if(!req.files||!req.files.length)return res.status(400).json({error:'Please select images'});
  const nl=req.body.names?JSON.parse(req.body.names):[],dl=req.body.dates?JSON.parse(req.body.dates):[],na=[];
  req.files.forEach((f,i)=>{const a={id:path.basename(f.filename,path.extname(f.filename)),name:nl[i]||'Anonymous',date:dl[i]||new Date().toISOString().slice(0,10).replace(/-/g,''),filename:f.filename,url:'/uploads/artworks/'+f.filename,status:'active',createdAt:Date.now()};artworks.push(a);na.push(a);generateWorkPage(a);compressForPagefire(a);});
  saveJSON(ARTWORKS_FILE,artworks);track('newArtworks',na.length);schedulePagefireDeploy();io.emit('artworks:batch',na);
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
    artworks.push(a);saveJSON(ARTWORKS_FILE,artworks);track('newArtworks');generateWorkPage(a);compressForPagefire(a);schedulePagefireDeploy();io.emit('artwork:new',a);
    res.json({success:true,matted:true,artwork:a});
  }catch(e){try{fs.unlinkSync(op);}catch(ee){}res.json({success:false,matted:false,error:e.message});}
});

app.put('/api/artworks/:id/archive',(req,res)=>{
  const a=artworks.find(x=>x.id===req.params.id);if(!a)return res.status(404).json({error:'Not found'});
  a.status='archived';a.archivedAt=Date.now();saveJSON(ARTWORKS_FILE,artworks);
  if(!archive.find(x=>x.id===a.id)){archive.push({...a});saveJSON(ARCHIVE_FILE,archive);}
  io.emit('artwork:archive',{id:a.id});res.json({success:true,artwork:a});
});
app.put('/api/artworks/:id/restore',(req,res)=>{
  const a=artworks.find(x=>x.id===req.params.id);if(!a)return res.status(404).json({error:'Not found'});
  a.status='active';delete a.archivedAt;archive=archive.filter(x=>x.id!==a.id);saveJSON(ARCHIVE_FILE,archive);saveJSON(ARTWORKS_FILE,artworks);
  io.emit('artwork:restore',{id:a.id,artwork:a});res.json({success:true,artwork:a});
});
app.delete('/api/artworks/:id/purge',(req,res)=>{
  const idx=artworks.findIndex(a=>a.id===req.params.id);if(idx===-1)return res.status(404).json({error:'Not found'});
  const a=artworks[idx];artworks.splice(idx,1);archive=archive.filter(x=>x.id!==a.id);saveJSON(ARTWORKS_FILE,artworks);saveJSON(ARCHIVE_FILE,archive);
  [path.join(WEB_WORKS_DIR,a.id+'.html'),path.join(ARTWORKS_DIR,a.filename),path.join(PAGEFIRE_WORKS_DIR,a.id+'.html'),path.join(PAGEFIRE_ARTWORKS_DIR,a.id+'.jpg'),path.join(PAGEFIRE_ARTWORKS_DIR,a.id+'_c.jpg')].forEach(p=>{try{if(fs.existsSync(p))fs.unlinkSync(p);}catch(e){}});
  io.emit('artwork:purge',{id:a.id});res.json({success:true});
});
app.post('/api/regenerate-pages',(req,res)=>{generateAllWorkPages();schedulePagefireDeploy();res.json({success:true,message:'Done'});});

app.get('/api/analytics/today',(req,res)=>{
  const t=ensureToday();const y=new Date(Date.now()-86400000);const yk=''+y.getFullYear()+String(y.getMonth()+1).padStart(2,'0')+String(y.getDate()).padStart(2,'0');const ys=analytics[yk]||{pageViews:0,visitors:[],newArtworks:0,displayViews:0,shareClicks:0};
  res.json({today:{pageViews:t.pageViews,uniqueVisitors:t.visitors.length,newArtworks:t.newArtworks,displayViews:t.displayViews,shareClicks:t.shareClicks},yesterday:{pageViews:ys.pageViews,uniqueVisitors:ys.visitors.length,newArtworks:ys.newArtworks,displayViews:ys.displayViews,shareClicks:ys.shareClicks}});
});

app.get('/api/dashboard',(req,res)=>{res.json({records:Object.entries(dashboardData).map(([d,x])=>({date:d,...x})).sort((a,b)=>b.date.localeCompare(a.date))});});
app.get('/api/dashboard/today',(req,res)=>{const k=todayKey(),d=dashboardData[k]||{experienceVisitors:0,groupJoins:0,wechatAdds:0,courseSignups:0,notes:''};res.json({date:k,...d});});
app.post('/api/dashboard/today',express.json(),(req,res)=>{
  const k=todayKey();if(!dashboardData[k])dashboardData[k]={};
  ['experienceVisitors','groupJoins','wechatAdds','courseSignups','notes'].forEach(f=>{if(req.body[f]!==undefined)dashboardData[k][f]=f==='notes'?String(req.body[f]):Number(req.body[f])||0;});
  dashboardData[k].updatedAt=Date.now();saveJSON(DASHBOARD_FILE,dashboardData);res.json({success:true,data:dashboardData[k]});
});

app.get('/api/background',(req,res)=>res.json(bgConfig));
app.post('/api/background/upload',uploadBg.single('image'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'No file'});
  if(bgConfig.filename&&bgConfig.filename!==req.file.filename){const p=path.join(BG_DIR,bgConfig.filename);if(fs.existsSync(p))try{fs.unlinkSync(p);}catch(e){}}
  bgConfig.filename=req.file.filename;bgConfig.url='/uploads/background/'+req.file.filename;saveJSON(BG_FILE,bgConfig);io.emit('background:update',bgConfig);
  res.json({success:true,background:bgConfig});
});
app.put('/api/background',express.json(),(req,res)=>{if(req.body.position)bgConfig.position=req.body.position;if(req.body.scale)bgConfig.scale=req.body.scale;saveJSON(BG_FILE,bgConfig);io.emit('background:update',bgConfig);res.json({success:true,background:bgConfig});});

app.get('/api/videos',(req,res)=>res.json(videos));
app.get('/api/videos/config',(req,res)=>res.json({interval:videoConfig.interval,repeat:videoConfig.repeat,enabled:videos.length>0}));
app.post('/api/videos/upload',uploadVideo.single('video'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'No video'});
  const v={id:path.basename(req.file.filename,path.extname(req.file.filename)),name:req.body.name||'Video',date:req.body.date||new Date().toISOString().slice(0,10).replace(/-/g,''),filename:req.file.filename,url:'/uploads/videos/'+req.file.filename,createdAt:Date.now()};
  videos.push(v);saveJSON(VIDEOS_FILE,videos);io.emit('videos:update',videos);res.json({success:true,video:v});
});
app.delete('/api/videos/:id',(req,res)=>{const idx=videos.findIndex(v=>v.id===req.params.id);if(idx===-1)return res.status(404).json({error:'Not found'});const v=videos[idx];videos.splice(idx,1);saveJSON(VIDEOS_FILE,videos);io.emit('videos:update',videos);const fp=path.join(VIDEOS_DIR,v.filename);if(fs.existsSync(fp))try{fs.unlinkSync(fp);}catch(e){}res.json({success:true});});
app.put('/api/videos/config',express.json(),(req,res)=>{videoConfig.interval=req.body.interval||300;videoConfig.repeat=req.body.repeat||2;saveJSON(VIDEOS_CONFIG_FILE,videoConfig);const cfg={interval:videoConfig.interval,repeat:videoConfig.repeat,enabled:videos.length>0};io.emit('videos:config',cfg);res.json({success:true,config:cfg});});

app.post('/api/track/cta-click',express.json(),(req,res)=>res.json({success:true}));

io.on('connection',(socket)=>{
  console.log('Client connected:',socket.id);
  socket.emit('sync',{artworks:artworks.filter(a=>a.status==='active'),background:bgConfig,videos});
  socket.on('display:connected',()=>track('displayViews'));
  socket.on('disconnect',()=>console.log('Disconnected:',socket.id));
});

app.use((err,req,res,next)=>{if(err){console.error(err.message);if(err.code==='LIMIT_FILE_SIZE')return res.status(400).json({error:'File too large'});return res.status(400).json({error:err.message||'Upload failed'});}next();});

generateAllWorkPages();
server.listen(PORT,()=>{
  const os=require('os'),ifs=os.networkInterfaces();let ip='localhost';
  for(const i of Object.values(ifs))for(const a of i)if(a.family==='IPv4'&&!a.internal){ip=a.address;break;}
  console.log('========================================');
  console.log('  Dunhuang AIGC Art Exhibition');
  console.log('  Server on port '+PORT);
  console.log('========================================');
  console.log('  Display: http://localhost:'+PORT+'/display');
  console.log('  Admin:   http://localhost:'+PORT+'/admin');
  console.log('  Mobile:  http://'+ip+':'+PORT+'/work/{id}');
  console.log('========================================');
});
