/**
 * CMS 自动抠图配置向导
 *
 * 交互式引导用户填写 API Key 等配置，
 * 自动生成 local-cutout-config.json
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_FILE = path.join(__dirname, 'local-cutout-config.json');
const TEMPLATE_FILE = path.join(__dirname, 'local-cutout-config.template.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question, defaultValue) {
  return new Promise(resolve => {
    const hint = defaultValue ? ` (${defaultValue})` : '';
    rl.question(`  ? ${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function main() {
  console.log('');
  console.log('==============================================');
  console.log('   🤖 CMS 自动抠图 - 配置向导');
  console.log('');
  console.log('   首次使用需要配置 API Key 和服务器地址');
  console.log('   请联系管理员获取这些信息');
  console.log('==============================================');
  console.log('');

  let template = { cms: { apiKey: '', apiBase: 'https://vapi.hkting.com/api/open-api/v1' }, server: { notifyUrl: '', displayAlbumUrl: '' }, rembg: { host: 'localhost', port: 7000 }, pollInterval: 5000 };

  // Try to load defaults from template
  try {
    if (fs.existsSync(TEMPLATE_FILE)) {
      const tpl = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
      template = { ...template, ...tpl };
    }
  } catch (e) { /* ignore */ }

  const apiKey = await ask('请输入 CMS API Key', template.cms.apiKey);
  const apiBase = await ask('请输入 API 地址', template.cms.apiBase);
  const notifyUrl = await ask('请输入通知回调地址（服务器地址）', template.server.notifyUrl || `http://localhost:3000/api/cms/cutout/notify`);
  const displayAlbumUrl = await ask('请输入展示相册接口地址', template.server.displayAlbumUrl || `http://localhost:3000/api/cms/display-album`);

  const config = {
    cms: { apiKey, apiBase },
    server: { notifyUrl, displayAlbumUrl },
    rembg: { host: 'localhost', port: 7000 },
    pollInterval: 5000
  };

  console.log('');
  console.log('  配置预览:');
  console.log(`    API Key:     ${apiKey.substring(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.slice(-4)}`);
  console.log(`    API 地址:    ${apiBase}`);
  console.log(`    通知地址:    ${notifyUrl}`);
  console.log('');

  const ok = await ask('确认保存？(Y/n)', 'Y');
  if (ok.toLowerCase() === 'n' || ok.toLowerCase() === 'no') {
    console.log('  已取消，配置未保存。');
    rl.close();
    return;
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  console.log(`  ✅ 配置已保存到 ${path.relative(path.join(__dirname, '..'), CONFIG_FILE)}`);
  console.log('');
  console.log('  现在可以重新运行启动CMS自动抠图.bat 了！');
  console.log('');

  rl.close();
}

main().catch(err => {
  console.error('配置出错:', err.message);
  rl.close();
  process.exit(1);
});
