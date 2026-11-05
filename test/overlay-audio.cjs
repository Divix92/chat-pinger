const {chromium}=require('playwright');const assert=require('node:assert/strict');const {installOverlayVolume}=require('../src/overlay-audio.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage();await page.setContent('<audio id="sound"></audio>');await page.evaluate(()=>window.nativeVolume=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume').get);
 await page.evaluate(installOverlayVolume,0.4);
 let result=await page.evaluate(()=>{const audio=document.getElementById('sound');audio.volume=0.6;return{widget:audio.volume,effective:window.nativeVolume.call(audio)};});assert.equal(result.widget,0.6);assert(Math.abs(result.effective-0.24)<0.0001);
 await page.evaluate(installOverlayVolume,0.2);result=await page.evaluate(()=>window.nativeVolume.call(document.getElementById('sound')));assert(Math.abs(result-0.12)<0.0001);
 const render=()=>{const context=new OfflineAudioContext(1,128,44100);const source=context.createConstantSource();source.offset.value=1;source.connect(context.destination);source.start();return context.startRendering().then(buffer=>buffer.getChannelData(0)[64]);};
 const level=await page.evaluate(render);assert(Math.abs(level-0.2)<0.0001);
 await page.evaluate(installOverlayVolume,0);assert(Math.abs(await page.evaluate(render))<0.0001);console.log('PASS: widget volume is preserved, HTML media output scales correctly, and rendered Web Audio respects volume and mute.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
