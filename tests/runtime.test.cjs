const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.join(__dirname,'..');
test('production serves the final compressed SPA and enforces origin checks', {skip:!fs.existsSync(path.join(root,'server/dist/index.html')),timeout:15000}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'mediapiayer-runtime-test-'));
  const port = await new Promise(resolve => { const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));}); });
  const origin=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server/server.js'],{cwd:root,env:{...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,JWT_SECRET:'fixture-runtime-key-of-more-than-32-bytes',DATABASE_PATH:path.join(temp,'db.sqlite'),MEDIA_DIRS:temp,TRANSMISSION_URL:'',SOCIAL_ENABLED:'false',ENABLE_DOWNLOADS:'false'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  try {
    let config;
    for(let i=0;i<80;i++){
      if(child.exitCode!==null)throw new Error('Server stopped: '+logs);
      try{config=await fetch(`${origin}/api/auth/config`);break}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(config?.status,200,logs);
    assert.equal((await config.json()).sessionProtocol,1);
    const page=await fetch(`${origin}/login`);assert.equal(page.status,200);
    const html=await page.text();const script=html.match(/src="([^"]+\.js)"/)[1];
    const js=await (await fetch(origin+script,{headers:{'Accept-Encoding':'gzip'}})).text();
    assert.ok(!js.includes('__VITE_PRELOAD__'),'compressed code must contain resolved preload references');
    const denied=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({email:'fixture@example.invalid',password:'fixture'})});
    assert.equal(denied.status,403);
  } finally {
    if(child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
