import {validateImage} from './image-upload.js';
import {createQuarantineUploader} from './quarantine.js';
import {privateImage,privatePreview} from './private-images.js';
import {createPhotoState} from './photo-state.js';

export function productPhoto({client,drafts,input,preview,item,uploadScope,editable=true,beforeUpload=()=>{},onState=()=>{},onChange=()=>{}}){
  const allowed=editable&&drafts?.imageEditing;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const root=el('div','photo-uploader'),drop=el('div','photo-drop'),empty=el('div','photo-empty');
  empty.append(el('strong','','Add a product photo'),el('span','','Drag a photo here or choose one below'));
  preview.alt='Product photo preview';preview.hidden=true;
  drop.append(preview,empty);
  const controls=el('div','photo-controls'),choose=el('button','','Choose photo'),remove=el('button','','Remove photo'),discard=el('button','','Discard selection'),retry=el('button','','Try preview again'),reload=el('button','','Reload product');
  for(const b of [choose,remove,discard,retry,reload])b.type='button';
  choose.classList.add('photo-choose');
  input.className='photo-file';input.setAttribute('aria-label','Choose a product photo');input.tabIndex=-1;
  const help=el('p','help','JPG, PNG or WebP · Up to 5 MiB · Up to 6 megapixels');
  const status=el('p','photo-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  const progress=el('progress');progress.max=100;progress.setAttribute('aria-label','Photo upload progress');progress.hidden=true;
  controls.append(choose,remove,discard,retry,reload);root.append(drop,input,help,controls,progress,status);
  let existingBlob,readSerial=0,initialController,disposed=false,view,frozen=false;
  const releaseExisting=()=>{++readSerial;initialController?.abort();if(existingBlob)URL.revokeObjectURL(existingBlob);existingBlob=null;};
  const noPhoto=!item||item.image_url==='/assets/product-placeholder.png';
  async function showExisting(){
    releaseExisting();preview.hidden=true;empty.hidden=false;
    if(noPhoto||disposed)return;
    const token=readSerial;initialController=new AbortController();
    try{
      const url=privateImage(item.image_url)?await privatePreview(client,item.image_url,AbortSignal.any([initialController.signal,AbortSignal.timeout(20000)])):item.image_url;
      if(disposed||token!==readSerial){if(url.startsWith('blob:'))URL.revokeObjectURL(url);return;}
      if(url.startsWith('blob:'))existingBlob=url;preview.src=url;preview.hidden=false;empty.hidden=true;
    }catch{if(!disposed&&token===readSerial){status.textContent='Saved photo preview unavailable. The saved photo will be kept.';}}
  }
  const uploader=createQuarantineUploader();
  const state=createPhotoState({validate:validateImage,
    upload:(file,options)=>{beforeUpload();return drafts.upload(file,{...uploadScope(),...options,uploader});},
    preview:async(url,signal)=>{
      const blob=await privatePreview(client,url,AbortSignal.any([signal,AbortSignal.timeout(20000)]));
      try{const check=new Image();check.src=blob;await check.decode();signal.throwIfAborted();return blob;}
      catch(error){URL.revokeObjectURL(blob);throw error;}
    },
    release:url=>URL.revokeObjectURL(url),
    change:s=>{
      view=s;status.textContent=s.message;root.dataset.state=s.phase;
      root.setAttribute('aria-busy',String(s.busy));input.disabled=choose.disabled=s.busy||s.phase==='uncertain'||!allowed||frozen;
      remove.disabled=s.busy||s.phase==='uncertain'||!allowed||frozen;
      remove.hidden=!s.blob&&noPhoto&&s.value!=='/assets/product-placeholder.png';
      discard.hidden=s.phase!=='error';retry.hidden=s.phase!=='error'||!s.confirmed;reload.hidden=s.phase!=='uncertain';
      progress.hidden=!s.busy;if(typeof s.progress==='number')progress.value=s.progress;else progress.removeAttribute('value');
      choose.textContent=(s.blob||!noPhoto)?'Replace photo':'Choose photo';
      if(s.blob){preview.src=s.blob;preview.hidden=false;empty.hidden=true;}
      else if(s.phase!=='ready'||s.value==='/assets/product-placeholder.png'){preview.hidden=true;preview.removeAttribute('src');empty.hidden=false;}
      onState(s);
    }});
  async function select(file){if(frozen||!file||view?.busy||view?.phase==='uncertain'||!allowed)return;releaseExisting();onChange();await state.select(file);input.value='';}
  choose.onclick=()=>input.click();input.onchange=()=>{select(input.files?.[0]);};
  remove.onclick=()=>{releaseExisting();if(state.remove()){onChange();empty.firstChild.textContent='No product photo';}};
  discard.onclick=()=>{if(!frozen&&state.discard()){showExisting();}};retry.onclick=()=>{if(!frozen)state.retryPreview();};
  reload.onclick=()=>{if(window.confirm('Reload this product? Unsaved changes will be lost.'))location.reload();};
  drop.addEventListener('dragover',event=>{event.preventDefault();if(!view?.busy&&view?.phase!=='uncertain')drop.classList.add('is-dragging');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('is-dragging'));
  drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('is-dragging');if(event.dataTransfer?.files.length!==1){status.textContent='Choose one photo at a time.';return;}select(event.dataTransfer.files[0]);});
  drop.addEventListener('click',()=>{if(!choose.disabled)input.click();});
  preview.addEventListener('load',()=>{preview.classList.remove('photo-reveal');requestAnimationFrame(()=>{if(preview.isConnected)preview.classList.add('photo-reveal');});});
  preview.addEventListener('error',()=>{if(!disposed){preview.hidden=true;empty.hidden=false;status.textContent='Photo preview unavailable.';}});
  const dispose=()=>{if(disposed)return;disposed=true;state.dispose();releaseExisting();observer.disconnect();};
  const observer=new MutationObserver(()=>{if(!root.isConnected)dispose();});
  queueMicrotask(()=>{if(root.isConnected)observer.observe(document.documentElement,{childList:true,subtree:true});});
  window.addEventListener('pagehide',dispose,{once:true});
  view=state.snapshot;remove.hidden=noPhoto;discard.hidden=retry.hidden=reload.hidden=true;
  choose.disabled=input.disabled=!allowed;remove.disabled=!allowed;
  onState(view);showExisting();
  return {element:root,setSaving(value){frozen=value;const s=state.snapshot;input.disabled=choose.disabled=remove.disabled=frozen||s.busy||s.phase==='uncertain'||!allowed;discard.disabled=retry.disabled=frozen;},selectedURL:async()=>state.selectedURL(),get canSave(){return state.snapshot.canSave;},dispose};
}
