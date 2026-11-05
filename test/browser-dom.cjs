const {chromium}=require('playwright');const assert=require('node:assert/strict');const {collectChat}=require('../src/browser-chat.cjs');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});try{
 const page=await browser.newPage();await page.setContent('<div id="chatroom-messages"><div class="chat-entry"><button title="viewer">old viewer</button><span class="chat-entry-content">history</span></div></div>');
 assert.deepEqual((await page.evaluate(collectChat)).messages,[]);await page.waitForTimeout(1600);assert.equal((await page.evaluate(collectChat)).ready,true);
 await page.evaluate(()=>{const el=document.createElement('div');el.className='chat-entry';el.innerHTML='<button title="viewer">new viewer</button><span class="chat-entry-content">new message</span>';document.querySelector('#chatroom-messages').append(el);});
 let result=await page.evaluate(collectChat);assert.equal(result.messages.length,1);assert.equal(result.messages[0].content,'new message');assert.equal(result.messages[0].username,'new viewer');assert.deepEqual((await page.evaluate(collectChat)).messages,[]);
 await page.evaluate(()=>document.querySelector('#chatroom-messages').remove());assert.equal((await page.evaluate(collectChat)).ready,false);
 console.log('PASS: browser fallback ignores history, observes new chat, extracts content, drains once, handles missing chat.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
