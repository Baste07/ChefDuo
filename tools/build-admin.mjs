// Repository-only Admin build: no customer artifact, SQL, journal or vault input.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateServiceConfig} from '../admin/config-policy.js';
export async function buildAdmin(dir,config){
 validateServiceConfig(config,'https://chefduo-auth-preflight.pages.dev/');
 await mkdir(dir,{recursive:true});
 await build({entryPoints:['admin/app.js'],bundle:true,format:'esm',outfile:dir+'/assets/app.js',minify:true});
 for(const route of ['','login','products','products/new','categories','audit-logs','settings','admins','accept','recover']){
  await mkdir(dir+'/admin/'+route,{recursive:true});await cp('admin/'+route+'/index.html',dir+'/admin/'+route+'/index.html');
 }
 await cp('admin/admin.css',dir+'/admin/admin.css');
 await writeFile(dir+'/admin/config.json',JSON.stringify({enabled:true,url:config.url,publishableKey:config.publishableKey,catalogEditing:false,allowLocalServices:false,allowLocalPreview:false},null,2));
 await writeFile(dir+'/_redirects','/ /admin/login/ 302\n');
 await writeFile(dir+'/404.html','<!doctype html><title>Not found</title><p>Page not found.</p>');
 await writeFile(dir+'/_headers',`/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data: https://mprtxauuwvhkicjpkhvw.supabase.co; connect-src 'self' https://mprtxauuwvhkicjpkhvw.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\n`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dir=resolve('dist-admin');if(dirname(dir)!==process.cwd())throw Error('Unexpected output');
 const saved=JSON.parse(await readFile('admin/config.json','utf8'));
 const config={url:process.env.CHEFDUO_PUBLIC_URL||saved.url,publishableKey:process.env.CHEFDUO_PUBLIC_KEY||saved.publishableKey};
 // These two variables are deliberately public. No secret/service key is read.
 validateServiceConfig(config,'https://chefduo-auth-preflight.pages.dev/');
 await rm(dir,{recursive:true,force:true});await buildAdmin(dir,config);
 console.log('Built dist-admin: Admin-only; catalog editing OFF; no upload or deployment.');
}
