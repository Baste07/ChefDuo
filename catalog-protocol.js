import {catalogDigest,visibleCatalog,verifyCatalogRevision} from './catalog-core.js';
let highest = 0;
export function atomicRequested() {
  return typeof document !== 'undefined' && document.documentElement.dataset.catalogDelivery === 'atomic-v1';
}
export async function validateSnapshot(envelope, minimum = 0) {
  if (!envelope || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < Math.max(1,minimum) ||
      !['available','unavailable'].includes(envelope.state)) throw Error('Invalid or stale catalog revision');
  const payload=envelope.payload;
  if (!payload || !Array.isArray(payload.categories) || !Array.isArray(payload.products)) throw Error('Incomplete revision');
  if (envelope.state==='available') await verifyCatalogRevision(payload,visibleCatalog(payload),envelope.digest);
  else if(payload.products.length || await catalogDigest(payload)!==envelope.digest) throw Error('Invalid withdrawal');
  return envelope;
}
export async function readSnapshot(client) {
  let stored=0;
  try { stored=Number(sessionStorage.getItem('chefduo-revision-sequence')||0); } catch {}
  if(!Number.isSafeInteger(stored)||stored<0)stored=0;
  const {data,error}=await client.rpc('chefduo_catalog_snapshot');
  if(error) throw Error('Catalog revision unavailable');
  const envelope=await validateSnapshot(data,Math.max(highest,stored));
  highest=envelope.sequence;
  try { sessionStorage.setItem('chefduo-revision-sequence',String(highest)); } catch {}
  return {client,revision:envelope.digest,catalog:envelope.payload,sequence:envelope.sequence,state:envelope.state};
}
export function parseCentavos(value) {
  if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(String(value))) throw Error('Enter a non-negative PHP amount with at most two decimal places.');
  const [whole,fraction='']=String(value).split('.');
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents>100000000)throw Error('Price exceeds the approved limit.');
  return cents;
}
