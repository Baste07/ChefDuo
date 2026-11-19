// Form-local photo state; upload completion never saves the product.
export function createPhotoState({validate,upload,preview,change=()=>{},release=()=>{}}) {
  let state={phase:'ready',value:null,confirmed:null,blob:null,message:''}, serial=0,disposed=false,controller;
  const busy=()=>['validating','uploading','processing','previewing'].includes(state.phase);
  const emit=()=>{if(!disposed)change({...state,busy:busy(),canSave:state.phase==='ready'});};
  function clearBlob(){if(state.blob)release(state.blob);state.blob=null;}
  async function show(url,token){
    const blob=await preview(url,controller.signal);
    if(disposed||token!==serial){release(blob);return false;}
    clearBlob();state.blob=blob;return true;
  }
  return {
    get snapshot(){return {...state,busy:busy(),canSave:state.phase==='ready'};},
    async select(file){
      if(disposed||busy()||state.phase==='uncertain')return false;
      const token=++serial;controller?.abort();controller=new AbortController();clearBlob();
      // Invalidate the earlier upload BEFORE any asynchronous work begins.
      state={phase:'validating',value:null,confirmed:null,blob:null,message:'Checking photo…'};emit();
      let submitted=false;
      try{
        await validate(file);if(disposed||token!==serial)return false;
        state.phase='uploading';state.message='Uploading photo…';emit();submitted=true;
        const url=await upload(file,{signal:controller.signal,onProgress:percent=>{
          if(disposed||token!==serial)return;
          state.phase=percent===100?'processing':'uploading';state.progress=percent;
          state.message=percent===100?'Processing photo…':'Uploading photo…';emit();
        }});
        if(disposed||token!==serial)return false;
        state.confirmed=url;state.phase='previewing';state.message='Preparing preview…';emit();
        if(!await show(url,token))return false;
        state.value=url;state.phase='ready';state.message='Photo ready. Save product to keep your changes.';emit();return true;
      }catch(error){
        if(disposed||token!==serial)return false;
        const uncertain=error.uncertain||(submitted&&!state.confirmed);
        state.value=null;state.phase=uncertain?'uncertain':'error';
        state.message=uncertain?'Upload not confirmed. Reload the product before trying again.':state.confirmed?'Photo uploaded, but the preview could not load. Try the preview again or discard this selection.':error.message||'Choose a valid JPG, PNG or WebP photo.';
        emit();return false;
      }
    },
    async retryPreview(){
      if(disposed||busy()||state.phase!=='error'||!state.confirmed)return false;
      const token=++serial;controller=new AbortController();state.phase='previewing';state.message='Preparing preview…';emit();
      try{if(!await show(state.confirmed,token))return false;state.value=state.confirmed;state.phase='ready';state.message='Photo ready. Save product to keep your changes.';emit();return true;}
      catch{if(!disposed&&token===serial){state.phase='error';state.message='Preview unavailable. Try the preview again or discard this selection.';emit();}return false;}
    },
    discard(){
      if(disposed||busy()||state.phase==='uncertain')return false;
      ++serial;controller?.abort();clearBlob();state={phase:'ready',value:null,confirmed:null,blob:null,message:'Selection discarded. Your saved photo is unchanged.'};emit();return true;
    },
    remove(){
      if(disposed||busy()||state.phase==='uncertain')return false;
      ++serial;controller?.abort();clearBlob();state={phase:'ready',value:'/assets/product-placeholder.png',confirmed:null,blob:null,message:'Photo removed. Save product to keep your changes.'};emit();return true;
    },
    selectedURL(){if(disposed||state.phase!=='ready')throw Error('Finish or resolve the photo upload before saving.');return state.value;},
    dispose(){disposed=true;++serial;controller?.abort();clearBlob();}
  };
}
