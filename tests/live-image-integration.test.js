import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {privatePreview} from '../admin/private-images.js';
import {uploadSelected} from '../admin/transport.js';
import {validateImage} from '../admin/image-upload.js';
import {createPhotoState} from '../admin/photo-state.js';

// Synthetic fixtures and stubbed transport only; never contact a hosted service.
const origin='https://mprtxauuwvhkicjpkhvw.supabase.co';
const actor='11111111-1111-4111-8111-111111111111';
const product='22222222-2222-4222-8222-222222222222';
const ticket='33333333-3333-4333-8333-333333333333';
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
const url=origin+'/functions/v1/catalog-photo/'+createHash('sha256').update(bytes).digest('hex')+'.png';
const session={access_token:'synthetic-not-a-credential',user:{id:actor}};
const client={auth:{getSession:async()=>({data:{session}})}};
const config=async()=>({url:origin,publishableKey:'synthetic-public-key'});
const file=new File([bytes],'fixture.png',{type:'image/png'});
const options={product,operation:'replace',version:8};

test('private preview: validates origin and session before any request',async()=>{
 const saved=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('Unexpected network');};
 try{
  await assert.rejects(privatePreview(client,'https://example.invalid/photo.png'));
  await assert.rejects(privatePreview({auth:{getSession:async()=>({data:{session:null}})}},url));
  await assert.rejects(privatePreview({auth:{getSession:async()=>({error:true,data:{session}})}},url));
  assert.equal(calls,0);
 }finally{globalThis.fetch=saved;}
});

test('private preview: rejects status, MIME, oversized, empty and altered bytes',async()=>{
 const saved=globalThis.fetch;
 try{
  for(const response of [new Response('',{status:403}),new Response(bytes,{headers:{'content-type':'image/jpeg'}}),new Response(bytes,{headers:{'content-type':'image/png','content-length':'5242881'}}),new Response(new Uint8Array(5242881),{headers:{'content-type':'image/png'}}),new Response('',{headers:{'content-type':'image/png'}}),new Response('altered',{headers:{'content-type':'image/png'}})]){
   globalThis.fetch=async()=>response;await assert.rejects(privatePreview(client,url));
  }
 }finally{globalThis.fetch=saved;}
});

test('private preview: authenticated, bounded, no redirects, exact hash and cancellation',async()=>{
 const saved=globalThis.fetch;let calls=0;
 globalThis.fetch=async(destination,opts)=>{calls++;assert.equal(destination,url);assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');assert.equal(opts.headers.authorization,'Bearer '+session.access_token);assert.ok(opts.signal instanceof AbortSignal);return new Response(bytes,{headers:{'content-type':'image/png'}});};
 try{
  const blob=await privatePreview(client,url);assert.ok(blob.startsWith('blob:'));URL.revokeObjectURL(blob);
  const controller=new AbortController();controller.abort();await assert.rejects(privatePreview(client,url,controller.signal));assert.equal(calls,2);
 }finally{globalThis.fetch=saved;}
});

async function transportCase({category=false,wrongTicket=false,wrongProduct=false,wrongDestination=false,deny=false,noSession=false,wrongOrigin=false}={}){
 const savedFetch=globalThis.fetch,savedXHR=globalThis.XMLHttpRequest;
 let controls=0,uploads=0,rpcs=0;
 const issued={id:ticket,bucket:'menu-images-quarantine',path:actor+'/'+ticket};
 if(wrongDestination)issued.path='unrelated/'+ticket;
 globalThis.fetch=async(destination,opts)=>{
  assert.equal(destination,origin+'/functions/v1/catalog-image');assert.equal(opts.redirect,'error');controls++;
  const body=JSON.parse(opts.body);
  if(deny)return Response.json({error:'Denied'},{status:401});
  return Response.json(body.action==='issue'?issued:{ticket:wrongTicket?actor:ticket,url,product:wrongProduct?actor:product,operation:'replace'});
 };
 globalThis.XMLHttpRequest=class{
  upload={};open(method,destination){assert.equal(method,'POST');assert.equal(destination,origin+'/storage/v1/object/menu-images-quarantine/'+actor+'/'+ticket);}
  setRequestHeader(name,value){if(name==='x-upsert')assert.equal(value,'false');}
  send(){uploads++;queueMicrotask(()=>{this.status=200;this.onload();this.onloadend();});}
 };
 const c={auth:{getSession:async()=>({data:{session:noSession?null:session}})},rpc:async(name)=>{assert.equal(name,'chefduo_category_image_issue');rpcs++;return {data:issued};}};
 try{
  const result=await uploadSelected({client:c,file,options:{...options,...(category?{kind:'category'}:{})},validate:async()=>{},readConfig:wrongOrigin?async()=>({url:'https://example.invalid'}):config});
  return {result,controls,uploads,rpcs};
 }catch(error){return {error,controls,uploads,rpcs};}
 finally{globalThis.fetch=savedFetch;globalThis.XMLHttpRequest=savedXHR;}
}
test('product upload: exact ticket, destination, product and immutable result',async()=>{
 assert.deepEqual(await transportCase(),{result:url,controls:2,uploads:1,rpcs:0});
});
test('category upload: dedicated category authorization, same scoped finalization',async()=>{
 assert.deepEqual(await transportCase({category:true}),{result:url,controls:1,uploads:1,rpcs:1});
});
test('upload rejects substituted ticket or product, without retry or saving',async()=>{
 for(const flags of [{wrongTicket:true},{wrongProduct:true}]){const r=await transportCase(flags);assert.ok(r.error.uncertain);assert.equal(r.controls,2);assert.equal(r.uploads,1);}
});
test('upload rejects bad destination before Storage; no finalization or retry',async()=>{
 const r=await transportCase({wrongDestination:true});assert.ok(r.error.uncertain);assert.equal(r.controls,1);assert.equal(r.uploads,0);
});
test('upload rejects missing session, wrong origin and denied authorization',async()=>{
 for(const flags of [{noSession:true},{wrongOrigin:true},{deny:true}]){const r=await transportCase(flags);assert.ok(r.error);assert.equal(r.uploads,0);assert.equal(r.controls,flags.deny?1:0);}
});
test('image validation rejects 5 MiB+1, empty, unsupported type and invalid PNG',async()=>{
 for(const f of [new File([new Uint8Array(5242881)],'large.png',{type:'image/png'}),new File([],'empty.png',{type:'image/png'}),new File(['text'],'text.txt',{type:'text/plain'}),new File(['not PNG'],'bad.png',{type:'image/png'})])await assert.rejects(validateImage(f));
});
test('photo selection never saves; replacement invalidates earlier result; discard keeps saved photo',async()=>{
 const state=createPhotoState({validate:async f=>{if(f==='invalid')throw Error('Invalid');},upload:async()=>url,preview:async()=> 'blob:synthetic'});
 assert.equal(await state.select('first'),true);assert.equal(state.selectedURL(),url);
 assert.equal(await state.select('invalid'),false);assert.equal(state.snapshot.canSave,false);assert.throws(()=>state.selectedURL());
 assert.equal(state.discard(),true);assert.equal(state.selectedURL(),null);state.dispose();
});
test('uncertain upload blocks save and repeat upload',async()=>{
 let calls=0;const state=createPhotoState({validate:async()=>{},upload:async()=>{calls++;throw Object.assign(Error('Unconfirmed'),{uncertain:true});},preview:async()=>''});
 await state.select(file);assert.equal(state.snapshot.phase,'uncertain');assert.throws(()=>state.selectedURL());assert.equal(await state.select(file),false);assert.equal(calls,1);state.dispose();
});
