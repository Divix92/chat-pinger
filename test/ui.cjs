const {chromium}=require('playwright'); const assert=require('node:assert/strict'); const fs=require('node:fs/promises'); const os=require('node:os'); const path=require('node:path');
const {Monitor}=require('../src/monitor.cjs'); const {createServer}=require('../src/server.cjs');
(async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pinger-ui-'));
 const monitor=new Monitor({resolveChannel:async()=>{throw new Error('Test channel lookup unavailable.');}});
 const service=await createServer({monitor,dataDir}); let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:1000}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); await page.goto(service.url);
  await page.getByRole('button',{name:'Retro messenger'}).click(); await page.waitForFunction(()=>document.querySelector('[data-sound="retro"]').getAttribute('aria-pressed')==='true');
  await page.locator('#volume').fill('30'); await page.locator('#volume').dispatchEvent('change'); await page.waitForFunction(()=>document.querySelector('#volume-value').value==='30%');
  await page.getByRole('button',{name:'Test sound'}).click();
  await page.locator('#channel').fill('https://evil.example/test'); await page.getByRole('button',{name:'Start listening'}).click(); await page.getByRole('alert').filter({hasText:'kick.com'}).waitFor();
  await page.locator('#channel').fill('test_channel'); await page.getByRole('button',{name:'Start listening'}).click(); await page.getByText('Test channel lookup unavailable.').waitFor();
  monitor.emit('chat',{id:'ui-test',username:'viewer',content:'<img src=x onerror=alert(1)>',time:Date.now()}); await page.locator('#activity li').waitFor(); assert.equal(await page.locator('#activity img').count(),0);
  await page.locator('#custom').setInputFiles(path.join(__dirname,'../obs/data/sounds/chime.wav')); await page.waitForFunction(()=>document.querySelector('#custom-label').textContent==='chime.wav');
  await page.getByRole('button',{name:'Mute alerts',exact:true}).click(); await page.getByRole('button',{name:'Unmute alerts'}).waitFor();
  await page.reload(); await page.getByRole('button',{name:'Unmute alerts'}).waitFor(); assert.equal(await page.locator('#volume').inputValue(),'30');
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:'/tmp/chat-pinger-mobile.png',fullPage:true}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1280,height:1000}); await page.screenshot({path:'/tmp/chat-pinger-desktop.png',fullPage:true}); assert.deepEqual(errors,[]);
  console.log('PASS: sound selection, preview, volume, URL validation, lookup error, safe message display, custom upload, persistence, mute, mobile layout.');
 }finally{await browser?.close();monitor.stop();await service.close();await fs.rm(dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
