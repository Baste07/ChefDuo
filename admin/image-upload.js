import {inspectImage,pngPixels,MAX_PIXELS} from './image-inspection.js';
import{privateImage,privatePreview}from'./private-images.js';
import {readConfig} from './data.js';
import {createQuarantineUploader} from './quarantine.js';
import {uploadSelected,bindExistingSelected} from './transport.js';

const maxUploadBytes = 5 * 1024 * 1024;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

function selectionError(file) {
  if (file.size > maxUploadBytes) return 'This photograph is larger than 5 MiB. Choose a smaller image.';
  if (!file.size || !imageTypes.has(file.type)) return 'Choose a non-empty PNG, JPEG or WebP photograph.';
  return '';
}

const validatedFiles = new WeakMap();
async function decodeSelection(file) {
  const error = selectionError(file);
  if (error) throw new Error(error);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = (offset, signature) => signature.every((byte, index) => bytes[offset + index] === byte);
  const valid = file.type === 'image/png' ? matches(0, [137,80,78,71,13,10,26,10])
    : file.type === 'image/jpeg' ? matches(0, [255,216,255])
    : matches(0, [82,73,70,70]) && matches(8, [87,69,66,80]);
  if (!valid) throw new Error('This file does not match its image format. Choose a PNG, JPEG or WebP photograph.');
  try {
    const complete = new Uint8Array(await file.arrayBuffer());
    const info = inspectImage(complete);
    if(info.mime !== file.type)throw Error('Format mismatch');
    if(info.mime === 'image/png')pngPixels(complete);
    if(typeof createImageBitmap !== 'function')throw Error('Use a browser with image preview support');
    const bitmap = await createImageBitmap(file);
    try {if(bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>MAX_PIXELS)throw Error('Image dimensions exceed limit');}
    finally {bitmap.close();}
  } catch {
    throw Error('This photograph could not be decoded safely. Choose a valid PNG, JPEG or WebP of at most 6 megapixels.');
  }
}

export async function validateImage(file) {
  const early = selectionError(file);
  if(early)throw Error(early);
  if(!validatedFiles.has(file))validatedFiles.set(file,decodeSelection(file));
  return validatedFiles.get(file);
}
const uncertain = () => Object.assign(Error('The upload result is unconfirmed. No product save was requested. Reopen the form and review verified photographs before retrying; do not submit again blindly.'),{uncertain:true});

export async function uploadImage(client,file,options={}) {
  return uploadSelected({client,file,options,validate:validateImage,readConfig});
}

export async function imageControls({client, drafts, input, preview, item, catalog, product = false,category = false,uploadScope}) {
  const label = document.createElement('div');
  if(!product){input.disabled=true;return {element:label,selectedURL:async()=>null};}
  if(!drafts || (!drafts.imageEditing && drafts.existingItemsOnly))return {element:label,selectedURL:async()=>null};
  label.className = 'field wide';
  const title = document.createElement('span');
  title.textContent = 'Or choose a verified photograph';
  const choice = document.createElement('select');
  choice.setAttribute('aria-label', 'Choose a verified photograph');
  choice.append(new Option(item ? 'Keep current photograph' : 'Use default photograph', ''));
  choice.append(new Option('Remove photograph — use placeholder', '__placeholder__'));
  const names = new Map([...catalog.products, ...catalog.categories].map(row => [row.image_url, row.name]));
  const {data, error} = await client.rpc('chefduo_catalog_assets');
  if (error) throw new Error('Verified photographs could not be loaded.');
  for (const asset of (category ? [] : data)) choice.append(new Option(names.has(asset.url) ? names.get(asset.url) + ' photograph' : 'Uploaded photograph ' + (choice.options.length), asset.url));
  label.append(title, choice);
  let previewBlob, localBlob, pending, uploadedFile, uploadedURL, validationError = '', outcomeUncertain=false;
  choice.addEventListener('change', async () => {
    if(choice.value==='__placeholder__'){if(pending||outcomeUncertain){choice.value='';status.textContent='Resolve the pending upload before changing its picture.';return;}validationError='';input.value='';input.setCustomValidity('');input.removeAttribute('aria-invalid');if(localBlob){URL.revokeObjectURL(localBlob);localBlob=undefined;}preview.dispatchEvent(new Event('local-photo-selected'));preview.src='/assets/product-placeholder.png';preview.hidden=false;status.textContent='Save draft to remove the photograph.';return;}
    if (choice.value) {outcomeUncertain=false;validationError = '';if(localBlob){URL.revokeObjectURL(localBlob);localBlob=undefined;}status.textContent='';input.value = '';input.setCustomValidity('');input.removeAttribute('aria-invalid');preview.dispatchEvent(new Event('local-photo-selected'));try{if(previewBlob)URL.revokeObjectURL(previewBlob);preview.src=privateImage(choice.value)?(previewBlob=await privatePreview(client,choice.value)):choice.value;preview.hidden=false;}catch{status.textContent='Private photograph unavailable.';}}
  });
  if (product) input.addEventListener('change', async () => {
    const file = input.files[0];
    validationError = '';
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    status.textContent = '';
    if (localBlob) {
      URL.revokeObjectURL(localBlob);
      localBlob = undefined;
      preview.hidden = true;
      preview.removeAttribute('src');
    }
    if (!file) return;
    choice.value = '';
    function rejectSelection(message) {
      validationError = message;
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid', 'true');
      status.textContent = message;
    }
    const error = selectionError(file);
    if (error) return rejectSelection(error);
    try {
      await validateImage(file);
      if (input.files[0] !== file) return;
      preview.dispatchEvent(new Event('local-photo-selected'));
      localBlob = URL.createObjectURL(file);
      preview.src = localBlob;
      preview.hidden = false;
    } catch (error) {
      if (input.files[0] === file) rejectSelection(error.message);
    }
  });
  else input.addEventListener('change',()=>{const file=input.files[0];input.setCustomValidity('');if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880)){input.value='';status.textContent='Choose JPEG, PNG or WebP up to 5 MiB.';return;}if(file)choice.value='';});
  const status = document.createElement('p');
  status.className = 'help';
  status.setAttribute('role', 'status');
  const progress = document.createElement('progress');
  progress.setAttribute('aria-label', 'Photograph upload progress');
  progress.max = 100; progress.value = 0; progress.hidden = true;
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.textContent = 'Cancel upload'; cancel.hidden = true;
  label.append(progress, cancel, status);
  const quarantineUploader=createQuarantineUploader();
  let controller,boundChoice,boundURL;
  cancel.onclick = () => controller?.abort();
  const removal = new MutationObserver(() => {if(!label.isConnected){controller?.abort();removal.disconnect();}});
  removal.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('pagehide', () => {removal.disconnect();controller?.abort();if(previewBlob)URL.revokeObjectURL(previewBlob);if(localBlob)URL.revokeObjectURL(localBlob);}, {once:true});
  return {
    element:label,
    async selectedURL() {
      if(outcomeUncertain)throw uncertain();
      if (validationError) throw new Error(validationError);
      if (pending) return pending;
      const file = input.files[0];
      if (!file) {
        if(choice.value==='__placeholder__'){if(!drafts.imageEditing)throw Error('Image changes remain disabled.');return '/assets/product-placeholder.png';}
        if (choice.value) {
          if(product&&privateImage(choice.value)&&choice.value!==item?.image_url){
            if(!drafts.imageEditing)throw Error('Image uploads remain disabled.');
            if(boundChoice!==choice.value){
              controller=new AbortController();
              pending=bindExistingSelected({client,url:choice.value,options:{...uploadScope?.(),signal:controller.signal},readConfig});
              try{boundURL=await pending;boundChoice=choice.value;}catch(error){if(error.uncertain)outcomeUncertain=true;throw error;}finally{pending=undefined;}
            }
            return boundURL;
          }
          return choice.value;
        }
        if (item) return null;
        return null; // New products may retain the existing staging placeholder.
      }
      if (!drafts.imageEditing) throw new Error('Image uploads remain disabled.');
      if (uploadedFile === file) return uploadedURL;
      pending = send(file);
      try { return await pending; } finally { pending = undefined; }
    }
  };
  async function send(file) {
      controller = new AbortController();
      progress.value = 0;
      progress.hidden = cancel.hidden = false;
      status.textContent = 'Uploading photograph…';
      input.disabled = choice.disabled = true;
      try {
        const url = await drafts.upload(file, {...uploadScope?.(),uploader:quarantineUploader,signal:controller.signal, onProgress:value => {
          if (value !== null) progress.value = value;
          status.textContent = value === 100 ? 'Verifying photograph…' : 'Uploading photograph…';
        }});
        if (!label.isConnected) throw new DOMException('Upload cancelled.', 'AbortError');
        uploadedFile = file;
        uploadedURL = url;
        status.textContent = 'Photograph processed privately. Save draft to attach it.';
        return url;
      } catch (error) {if(error.uncertain)outcomeUncertain=true;status.textContent = error.message; throw error;}
      finally {cancel.hidden = progress.hidden = true; input.disabled = !drafts.imageEditing; choice.disabled = false;}
  }
}
