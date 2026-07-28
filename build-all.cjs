const fs = require("fs"), path = require("path"), os = require("os"), { execSync } = require("child_process");
const BASE = __dirname;
const DATA_FILE = BASE + "/data/artworks.json";
const ORIGINALS = BASE + "/public/uploads/originals";
const DEPLOY_DIR = BASE + "/deploy-pagefire";
const DEPLOY_WORKS = DEPLOY_DIR + "/works";
const DEPLOY_ART = DEPLOY_DIR + "/artworks";
const PUBLIC_WORKS = BASE + "/public/works";
const TEMPLATE = BASE + "/public/demo-share-page-enhanced.html";

async function main() {
  console.log("========================================");
  console.log("  作品分享页 · 统一生成脚本 (JPG版)");
  console.log("========================================\n");

  // 1. Load artworks
  let raw = fs.readFileSync(DATA_FILE, "utf-8").replace(/^\uFEFF/, "");
  const all = JSON.parse(raw);
  const withCrop = all.filter(a => fs.existsSync(path.join(ORIGINALS, a.id + "_c.png")));
  console.log(`[1/5] 有裁剪图: ${withCrop.length}/${all.length}`);

  // 2. Generate works-data.json (JPG paths)
  const dataJson = withCrop.map(a => ({
    id: a.id, name: a.name, date: a.date,
    url: "artworks/" + a.id + "_c.jpg",
    status: a.status, isActive: a.status === "active"
  }));
  [DEPLOY_DIR + "/works-data.json", BASE + "/public/works-data.json"].forEach(p => {
    fs.writeFileSync(p, JSON.stringify(dataJson), "utf-8");
  });
  console.log("[2/5] data.json ✓");

  // 3. Generate share pages with JPG paths
  const template = fs.readFileSync(TEMPLATE, "utf-8");
  let pageCount = 0;
  const outputs = [
    { dir: DEPLOY_WORKS, imgPath: id => "/artworks/" + id + "_c.jpg" },
    { dir: PUBLIC_WORKS, imgPath: id => "/uploads/originals/" + id + "_c.png" }
  ];
  
  withCrop.forEach(a => {
    const displayDate = a.date
      ? a.date.slice(0,4) + "年" + parseInt(a.date.slice(4,6)) + "月" + parseInt(a.date.slice(6,8)) + "日"
      : "";
    outputs.forEach(out => {
      let html = template
        .replace(/\{\{name\}\}/g, a.name)
        .replace(/artwork-demo\.jpg/g, out.imgPath(a.id))
        .replace(/2026年07月01日/g, displayDate)
        .replace(/小明_AI作品\.png/g, a.name + "_AI作品.png")
        .replace(/src="logo-brand\.png"/g, 'src="/logo-brand.png"');
      fs.writeFileSync(path.join(out.dir, a.id + ".html"), html, "utf-8");
    });
    pageCount++;
  });
  console.log(`[3/5] 分享页 × ${pageCount} ✓`);

  // 4. Convert PNG → JPG (sharp, q85)
  let imgCount = 0;
  const sharp = require("sharp");
  const tmpDir = os.tmpdir();
  
  for (const a of withCrop) {
    const src = path.join(ORIGINALS, a.id + "_c.png");
    const dst = path.join(DEPLOY_ART, a.id + "_c.jpg");
    if (fs.existsSync(dst)) continue;
    const tmp = path.join(tmpDir, a.id + "_c.jpg");
    await sharp(src).jpeg({ quality: 85 }).toFile(tmp);
    fs.copyFileSync(tmp, dst);
    fs.unlinkSync(tmp);
    imgCount++;
  }
  console.log(`[4/5] 转JPG × ${imgCount} ✓`);

  // 5. Clean old non-matching files
  const currentIds = withCrop.map(a => a.id);
  let cleaned = 0;
  fs.readdirSync(DEPLOY_ART).forEach(f => {
    if (f.startsWith('.')) return;
    const id = f.replace(/\.(jpg|png|webp)$/i, "").replace("_c", "");
    if (!currentIds.includes(id) || !f.endsWith("_c.jpg")) {
      fs.unlinkSync(path.join(DEPLOY_ART, f));
      cleaned++;
    }
  });
  
  // Final stats
  const totalSize = fs.readdirSync(DEPLOY_DIR, { recursive: true })
    .filter(f => fs.statSync(path.join(DEPLOY_DIR, f)).isFile())
    .reduce((sum, f) => sum + fs.statSync(path.join(DEPLOY_DIR, f)).size, 0);
  
  console.log(`[5/5] 清理 × ${cleaned}`);
  console.log(`\n✅ 完成! ${withCrop.length}幅 / ${(totalSize/1e6).toFixed(1)}MB`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });


