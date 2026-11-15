// Generates ONLY local artifacts; no Git, deployment, secret, or database operation.
import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';
import{buildAdmin}from'./build-admin.mjs';
const root='.artifacts/stage-d1-r2';fs.mkdirSync(root,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const config=JSON.parse(fs.readFileSync('admin/config.json'));
if(config.url!=='https://mprtxauuwvhkicjpkhvw.supabase.co')throw Error('Wrong backend');
const adminOnly=process.argv.includes('--admin-only'),output=adminOnly?'dist-admin':root+'/admin';
await buildAdmin(path.resolve(output),config);
fs.writeFileSync(output+'/admin/config.json',JSON.stringify({enabled:true,url:config.url,publishableKey:config.publishableKey,catalogEditing:'atomic-v1',capabilityRead:true,imageEditing:false,existingItemsOnly:true,allowLocalServices:false,allowLocalPreview:false},null,2)+'\n');
if(adminOnly){console.log('Built repository-only Stage D1 dist-admin; images OFF, server activation required. No deployment.');process.exit(0);}
const sources=[];function walk(dir,out,filter=()=>true){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p,out,filter);else if(filter(p))out.push({path:p,bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))});}}
walk('admin',sources,p=>/\.(js|html|css)$/.test(p));
for(const p of ['package.json','package-lock.json','catalog-protocol.js','catalog-core.js','tools/build-admin.mjs','tools/build-stage-d1-r2.mjs','tools/prepare-stage-d1-r2.mjs','tools/rehearse-stage-d1-r2.mjs','tools/setup-stage-d1-edge.mjs','tests/stage-d1-r2-browser.mjs','supabase/functions/catalog-image/adapter.js','supabase/functions/catalog-image/handler.js','supabase/functions/catalog-image/index.ts','supabase/functions/admin-accounts/auth-proof.js'])sources.push({path:p,bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))});
const publicConfig='admin/config.json';sources.push({path:publicConfig,bytes:fs.statSync(publicConfig).size,sha256:sha(fs.readFileSync(publicConfig))});
for(const p of ['tools/rehearse-stage-d1-r2-upgrade.mjs','tools/d1-catalog-proposal.sql','tools/d1-disable-editing-proposal.sql','tools/d2-stage-a-install.sql','.artifacts/d1/bootstrap-assets.sql','tests/stage-d1.test.js'])sources.push({path:p,bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))});
const generated=[];walk(root+'/admin',generated);for(const f of generated)f.path=f.path.slice((root+'/admin/').length);
const sql=[];walk('tools/stage-d1-r2',sql);
for(const p of ['tests/stage-d1-r2.test.js','tools/rehearse-stage-d1-policy-authority.mjs'])sources.push({path:p,bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))});
for(const [name,files]of [['source',sources],['admin',generated],['sql',sql]]){files.sort((a,b)=>a.path.localeCompare(b.path));const m=JSON.stringify({scope:name,productionActivation:'NOT AUTHORIZED',files},null,2)+'\n';fs.writeFileSync(root+'/'+name+'-manifest.json',m);console.log(JSON.stringify({manifest:name,files:files.length,sha256:sha(m)}));}
