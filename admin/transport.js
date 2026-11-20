import {createQuarantineUploader} from './quarantine.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function bindExistingSelected({client,url,options,readConfig}){
 if(!/^https:\/\/mprtxauuwvhkicjpkhvw\.supabase\.co\/functions\/v1\/catalog-photo\/[a-f0-9]{64}\.png$/.test(url)||!uuid.test(options?.product)||!['create','replace'].includes(options.operation)||!Number.isInteger(options.version))throw Error('Verified product image scope required.');
 const config=await readConfig(false);if(config.url!=='https://mprtxauuwvhkicjpkhvw.supabase.co')throw Error('Wrong production image backend.');
 const {data,error}=await client.auth.getSession();if(error||!data?.session?.access_token)throw Error('Sign in again before binding a photograph.');
 try{
 const response=await fetch(config.url+'/functions/v1/catalog-image',{method:'POST',headers:{apikey:config.publishableKey,authorization:'Bearer '+data.session.access_token,'content-type':'application/json'},body:JSON.stringify({action:'reuse',url,product:options.product,operation:options.operation,version:options.version}),redirect:'error',signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(25000)])});
 const result=await response.json();if(!response.ok||result.url!==url||result.product!==options.product||result.operation!==options.operation)throw Error('Binding not confirmed');return result.url;
 }catch{throw Object.assign(Error('Photograph binding is unconfirmed. No draft save requested.'),{uncertain:true});}
}
export async function uploadSelected({client,file,options,validate,readConfig}){
 await validate(file); // No config, Auth or transport access before validation.
 if(!uuid.test(options.product)||!['create','replace'].includes(options.operation)||!Number.isInteger(options.version))throw Error('Product upload scope required.');
 const config=await readConfig(false);if(config.url!=='https://mprtxauuwvhkicjpkhvw.supabase.co')throw Error('Wrong production image backend.');
 const {data,error}=await client.auth.getSession();const session=data?.session;
 if(error||!session?.access_token||!uuid.test(session.user?.id))throw Error('Sign in again before uploading.');
 const headers={apikey:config.publishableKey,authorization:'Bearer '+session.access_token,'content-type':'application/json'};
 const control=async body=>{
  if(options.kind==='category'&&body.action==='issue'){
    const {data,error}=await client.rpc('chefduo_category_image_issue',{p_category:options.product,p_operation:options.operation,p_bytes:body.bytes,p_mime:body.mime,p_sha:body.sha,p_version:options.version});
    if(error)throw Error(error.message||'Category upload authorization rejected.');return data;
  }
  const r=await fetch(config.url+'/functions/v1/catalog-image',{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(25000)])});
  const result=await r.json();if(!r.ok)throw Error(result.error||'Upload not confirmed.');return result;
 };
 let issuedTicket;
 const storageUpload=(ticket,bytes,{signal})=>new Promise((resolve,reject)=>{
  if(ticket.bucket!=='menu-images-quarantine'||!uuid.test(ticket.id)||ticket.path!==session.user.id+'/'+ticket.id)return reject(Error('Invalid private upload destination.'));
  issuedTicket=ticket.id;
  const request=new XMLHttpRequest(),abort=()=>request.abort();
  request.open('POST',config.url+'/storage/v1/object/'+ticket.bucket+'/'+ticket.path);request.timeout=30000;
  request.setRequestHeader('apikey',config.publishableKey);request.setRequestHeader('authorization','Bearer '+session.access_token);request.setRequestHeader('content-type',file.type);request.setRequestHeader('x-upsert','false');
  request.upload.onprogress=e=>options.onProgress?.(e.lengthComputable?Math.round(e.loaded*100/e.total):null);
  request.onload=()=>request.status>=200&&request.status<300?resolve():reject(Error('Private Storage upload rejected.'));
  request.onerror=request.ontimeout=()=>reject(Error('Private upload outcome unconfirmed.'));
  request.onabort=()=>reject(new DOMException('Cancelled','AbortError'));
  request.onloadend=()=>signal?.removeEventListener('abort',abort);
  if(signal?.aborted)return reject(new DOMException('Cancelled','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});request.send(bytes);
 });
 const result=await (options.uploader||createQuarantineUploader()).upload({file,product:options.product,operation:options.operation,version:options.version,validate,control,storageUpload,signal:options.signal});
 if(result.ticket!==issuedTicket||!new RegExp('^https://mprtxauuwvhkicjpkhvw\\.supabase\\.co/functions/v1/catalog-photo/[a-f0-9]{64}\\.png$').test(result.url)||result.product!==options.product||result.operation!==options.operation)throw Object.assign(Error('Upload association is unconfirmed.'),{uncertain:true});
 return result.url;
}
