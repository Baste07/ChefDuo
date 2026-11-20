const pattern=/^https:\/\/mprtxauuwvhkicjpkhvw\.supabase\.co\/functions\/v1\/catalog-photo\/[a-f0-9]{64}\.png$/;
export const privateImage=url=>pattern.test(url||'');
export async function privatePreview(client,url,signal){
 if(!privateImage(url))throw Error('Invalid private photograph URL.');const{data,error}=await client.auth.getSession();if(error||!data.session)throw Error('Sign in to preview this photograph.');
 signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]);
 const response=await fetch(url,{headers:{authorization:'Bearer '+data.session.access_token},signal,cache:'no-store',redirect:'error'});
 if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png')throw Error('Private photograph unavailable.');
 if(Number(response.headers.get('content-length'))>5242880)throw Error('Photograph exceeds preview limit.');
 if(!response.body)throw Error('Private photograph unavailable.');
 const reader=response.body.getReader();const chunks=[];let total=0;try{for(;;){signal.throwIfAborted();const r=await reader.read();signal.throwIfAborted();if(r.done)break;total+=r.value.length;if(total>5242880)throw Error('Photograph exceeds preview limit.');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
 if(!total)throw Error('Private photograph unavailable.');
 const bytes=new Uint8Array(total);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==url.split('/').pop().slice(0,-4))throw Error('Private photograph integrity mismatch.');
 return URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
}
