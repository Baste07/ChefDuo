const pattern=/^https:\/\/mprtxauuwvhkicjpkhvw\.supabase\.co\/functions\/v1\/catalog-photo\/[a-f0-9]{64}\.png$/;
export const privateImage=url=>pattern.test(url||'');
export async function privatePreview(client,url,signal){
 if(!privateImage(url))throw Error('Invalid private photograph URL.');const{data,error}=await client.auth.getSession();if(error||!data.session)throw Error('Sign in to preview this photograph.');
 const response=await fetch(url,{headers:{authorization:'Bearer '+data.session.access_token},signal,cache:'no-store',redirect:'error'});
 if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png')throw Error('Private photograph unavailable.');
 const reader=response.body.getReader();const chunks=[];let total=0;try{for(;;){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>5242880)throw Error('Photograph exceeds preview limit.');chunks.push(r.value);}}finally{await reader.cancel();}
 return URL.createObjectURL(new Blob(chunks,{type:'image/png'}));
}
