import {parseCentavos,validateSnapshot} from '../catalog-protocol.js';
export {parseCentavos};
const tables={menu_products:'products',menu_categories:'categories'};
function orderedCatalog(catalog){
  const view=structuredClone(catalog);
  for(const key of ['products','categories'])view[key].sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id));
  return view;
}
export class CatalogDrafts {
  constructor(client,{imageEditing=true,existingItemsOnly=false,capabilityRead=false}={}){this.client=client;this.imageEditing=imageEditing;this.existingItemsOnly=existingItemsOnly;this.capabilityRead=capabilityRead;this.editingEnabled=capabilityRead?false:undefined;}
  async rpc(action,payload=null){
    if(['save','publish','restore'].includes(action)&&this.editingEnabled===false)throw Error('Catalog editing and publishing are disabled.');
    const {data,error}=await this.client.rpc('chefduo_catalog_admin',{p_action:action,p_expected:this.version??null,p_payload:payload});
    if(error)throw Error(error.message);
    return data;
  }
  async read(){
    if(this.capabilityRead){
      const {data:cap,error}=await this.client.rpc('chefduo_catalog_capabilities');if(error||typeof cap?.product_editing!=='boolean')throw Error('Catalog access could not be verified.');
      this.editingEnabled=cap.product_editing===true;
      if(!this.editingEnabled){
        const {data,error}=await this.client.rpc('chefduo_catalog_snapshot');if(error)throw Error('Published catalog is unavailable.');
        const published=await validateSnapshot(data,this.sequence||0);this.version=null;this.sequence=published.sequence;this.catalog=published.payload;
      }
    }
    if(!this.capabilityRead||this.editingEnabled){const r=await this.rpc('read');this.version=r.version;this.sequence=r.sequence;this.catalog=r.catalog;}
    return orderedCatalog(this.catalog);
  }
  view(){return orderedCatalog(this.catalog);}
  async save(table,payload,id){
    const key=tables[table];if(!key)throw Error('Unsupported catalog table');
    const catalog=structuredClone(this.catalog);
    const index=id?catalog[key].findIndex(r=>r.id===id):-1;
    if(this.existingItemsOnly&&index<0)throw Error('New items remain disabled while image management is held.');
    if(!this.imageEditing&&['image_url','image_path'].some(k=>Object.hasOwn(payload,k)&&payload[k]!==catalog[key][index]?.[k]))throw Error('Image references are locked in this release.');
    if(id&&index<0)throw Error('Refresh: draft item not found');
    const row=index<0?{id:crypto.randomUUID(),description:'',image_url:'',image_path:null,status:'hidden',sort_order:0,updated_at:new Date().toISOString(),...(key==='products'?{legacy_key:null,price_cents:0,variants:[],flavors:[],featured_order:null}:{}),...payload}:{...catalog[key][index],...payload};
    if(index<0){if(key==='products'&&!row.legacy_key)row.legacy_key='d1-'+row.id;catalog[key].push(row);}else catalog[key][index]=row;
    await this.rpc('save',catalog);await this.read();return row;
  }
  async remove(table,item){
    if(item.status!=='archived')throw Error('Archive before removing from the draft. Published revisions remain preserved.');
    const key=tables[table],catalog=structuredClone(this.catalog);if(!key)throw Error('Unsupported catalog table');
    if(key==='categories'&&catalog.products.some(p=>p.category_id===item.id))throw Error('Move dependent products first.');
    catalog[key]=catalog[key].filter(r=>r.id!==item.id);await this.rpc('save',catalog);await this.read();
  }
  async publish(){const r=await this.rpc('publish');await this.read();return r;}
  async events(){return this.rpc('events');}
  async restore(eventId){await this.rpc('restore',{event_id:eventId});return this.read();}
  async upload(file){
    if(!this.imageEditing)throw Error('Image uploads and replacements are disabled in this release.');
    const {data,error}=await this.client.functions.invoke('catalog-image',{body:file,headers:{'Content-Type':file.type}});
    if(error||!data?.url)throw Error('Image verification failed; no draft reference was changed.');
    return data.url;
  }
}
