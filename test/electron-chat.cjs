// Run the real Electron app without attaching a second DevTools client to it.
// Its chat monitor owns the browser inspector; external CDP tooling can interfere.
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pinger-electron-'));
 const fixture=process.argv[2]||'electron-fixture.cjs';if(!['electron-fixture.cjs','overlay-fixture.cjs'].includes(fixture))throw new Error('Unknown Electron fixture');
 const child=spawn(require('electron'),['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required',path.join(__dirname,fixture)],{env:{...process.env,XDG_CONFIG_HOME:directory},stdio:['ignore','pipe','pipe']});
 let errors='';let timedOut=false;child.stdout.on('data',chunk=>process.stdout.write(chunk));child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-16000);});
 const deadline=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},45000);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(deadline);
 await fs.rm(directory,{recursive:true,force:true});
 if(code!==0||timedOut){if(errors)process.stderr.write(errors);throw new Error(timedOut?'Electron integration test exceeded 45 seconds.':`Electron integration test exited with ${code}.`);}
})().catch(error=>{console.error(error);process.exitCode=1;});
