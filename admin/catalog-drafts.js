import {parseCentavos} from '../catalog-protocol.js';
export {parseCentavos};
const tables={menu_products:'products',menu_categories:'categories'};
export class CatalogDrafts {
  constructor(client){this.client=client;}
  async rpc(action,payload=null){
    const {data,error}=await this.client.rpc('chefduo_catalog_admin',{p_action:action,p_expected:this.version??null,p_payload:payload});
    if(error)throw Error(error.message);
    return data;
  }
  async read(){const r=await this.rpc('read');this.version=r.version;this.sequence=r.sequence;this.catalog=r.catalog;for(const key of ['products','categories'])this.catalog[key].sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id));return structuredClone(this.catalog);}
  async save(table,payload,id){
    const key=tables[table];if(!key)throw Error('Unsupported catalog table');
    const catalog=structuredClone(this.catalog);
    const index=id?catalog[key].findIndex(r=>r.id===id):-1;
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
    const {data,error}=await this.client.functions.invoke('catalog-image',{body:file,headers:{'Content-Type':file.type}});
    if(error||!data?.url)throw Error('Image verification failed; no draft reference was changed.');
    return data.url;
  }
}
