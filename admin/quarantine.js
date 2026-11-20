export function quarantineHandler(d){
 const respond=(status,body,headers)=>new Response(body===null?null:JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
 return async request=>{
  const origin=request.headers.get('origin');
  const cors={'vary':'Origin','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST, OPTIONS',...(d.origins?.includes(origin)?{'access-control-allow-origin':origin}:{})};
  const reply=(status,body)=>respond(status,body,cors);
  if(origin&&!d.origins?.includes(origin))return reply(403,{error:'Origin denied.'});
  if(request.method==='OPTIONS')return reply(204,null);
  if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply(415,{error:'Small JSON control requests only.'});
  let ticket,lease,actor;
  try{
   actor=await d.authorize(request);if(!actor)return reply(401,{error:'Active staff session required.'});
   if(Number(request.headers.get('content-length'))>2048||!request.body)throw Error('Control request too large or missing');
   const reader=request.body.getReader(),bodySignal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]);
   const abortBody=()=>{reader.cancel().catch(()=>{});};bodySignal.addEventListener('abort',abortBody,{once:true});
   let n=0,chunks=[];try{for(;;){bodySignal.throwIfAborted();const r=await reader.read();bodySignal.throwIfAborted();if(r.done)break;n+=r.value.length;if(n>2048)throw Error('Control request too large');chunks.push(r.value);}}finally{bodySignal.removeEventListener('abort',abortBody);await reader.cancel().catch(()=>{});}
   const raw=new Uint8Array(n);let at=0;for(const c of chunks){raw.set(c,at);at+=c.length;}const body=JSON.parse(new TextDecoder().decode(raw));
   if(body.action==='issue')return reply(200,await d.issue(actor,body));
   if(body.action==='reuse')return reply(200,await d.reuse(actor,body));
   if(!/^[a-f0-9-]{36}$/.test(body.ticket||''))throw Error('Ticket required');ticket=body.ticket;
   if(body.action==='status'||body.action==='cancel')return reply(200,await d.work(body.action,actor,ticket));
   if(body.action!=='finalize')throw Error('Unknown operation');
   const job=await d.work('claim',actor,ticket);lease=job.lease;
   // No client URL, bucket override, bytes or MIME is accepted here.
   const context={signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)])};
   const bytes=await d.download(job.path,5242880,context);
   if(bytes.length!==job.bytes||bytes.length>5242880)throw Error('Staged length mismatch');
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
   if(sha!==job.sha256)throw Error('Staged checksum mismatch');
   context.signal.throwIfAborted();
   const result=await d.process(bytes,job.mime,actor,context);
   context.signal.throwIfAborted();
   const bound=await d.work('finish',actor,ticket,lease,result.url);
   // Deleting raw input cannot roll back an acknowledged canonical result.
   // The durable ticket remains GC-pending if removal fails.
   try{await d.remove(job.path);await d.work('gc_done',actor,ticket);}catch{}
   return reply(200,{url:bound.url,product:bound.product,operation:bound.operation,ticket});
  }catch(error){
   if(ticket&&lease){try{await d.work('fail',actor,ticket,lease);}catch{}}
   return reply(400,{error:'Upload control request rejected or unconfirmed. Inspect ticket status before retrying.'});
  }
 };
}
export async function cleanupQuarantine(d,context={}){
 const jobs=await d.plan(context);const result={deleted:0,pending:0};
 for(const job of jobs){try{await d.remove(job.path,context);await d.done(job.id,context);result.deleted++;}catch{result.pending++;}}
 return result;
}

// Deliberately transport-independent. Existing UI validation runs BEFORE this;
// existing progress/cancel UI can supply the storageUpload implementation.
export async function uploadViaQuarantine({file,product,operation,version,validate,control,storageUpload,signal}){
 await validate(file);if(signal?.aborted)throw Error('Cancelled');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
 const ticket=await control({action:'issue',product,operation,version,bytes:file.size,mime:file.type,sha});
 try{
  if(signal?.aborted)throw Error('Cancelled');
  await storageUpload(ticket,file,{signal,upsert:false});
  if(signal?.aborted)throw Error('Cancelled');
  return await control({action:'finalize',ticket:ticket.id});
 }catch(error){
  // No upload/finalization retry. Status is a read-only reconciliation operation.
  throw Object.assign(Error('Upload outcome requires reconciliation; no product save was requested.'),{ticket:ticket.id,uncertain:true});
 }
}

// One controller per product form. Uncertain outcomes stay blocked until an
// explicit read-only ticket-status reconciliation, never an automatic retry.
export function createQuarantineUploader(){
 let pending=false,unconfirmed=null;
 return {
  async upload(options){
   if(pending||unconfirmed)throw Error('Upload pending or awaiting reconciliation.');
   pending=true;
   try{return await uploadViaQuarantine(options);}
   catch(error){if(error.uncertain)unconfirmed=error.ticket;throw error;}
   finally{pending=false;}
  },
  async reconcile(control){
   if(!unconfirmed)throw Error('No uncertain ticket.');
   const result=await control({action:'status',ticket:unconfirmed});
   if(!['finalized','failed','expired','cancelled'].includes(result.state))throw Error('Still awaiting final outcome.');
   unconfirmed=null;return result;
  }
 };
}
