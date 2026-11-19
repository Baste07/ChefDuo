import {applyCategoryOrder} from './category-order.js';
import {applyProductOrder} from './product-order.js';
import {uploadImage} from './image-upload.js';
import {parseCentavos,validateSnapshot} from '../catalog-protocol.js';
export {parseCentavos};
const tables={menu_products:'products',menu_categories:'categories'};
function orderedCatalog(catalog){
  const view=structuredClone(catalog);
  for(const key of ['products','categories'])view[key].sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id));
  return view;
}
export class CatalogDrafts {
  constructor(client,{imageEditing=true,existingItemsOnly=false,capabilityRead=false}={}){this.client=client;this.requestImages=imageEditing;this.requestNewItems=!existingItemsOnly;this.imageEditing=false;this.existingItemsOnly=true;this.capabilityRead=capabilityRead;this.editingEnabled=false;this.publishingEnabled=false;this.newProducts=false;this.categoryEditing=false;}
  async rpc(action,payload=null){
    if(['save','restore'].includes(action)&&!this.editingEnabled)throw Error('Product draft editing is disabled.');
    if(action==='publish'&&!this.publishingEnabled)throw Error('Menu publishing is disabled.');
    const {data,error}=await this.client.rpc('chefduo_catalog_admin',{p_action:action,p_expected:this.version??null,p_payload:payload});
    if(error)throw Error(error.message);
    return data;
  }
  async read(){
    if(this.capabilityRead){
      const {data:cap,error}=await this.client.rpc('chefduo_catalog_capabilities');if(error||typeof cap?.product_editing!=='boolean')throw Error('Catalog access could not be verified.');
      this.editingEnabled=cap.product_editing===true;
      this.publishingEnabled=typeof cap.publishing==='boolean'?cap.publishing:this.editingEnabled;
      this.categoryEditing=this.editingEnabled&&(typeof cap.category_editing==='boolean'?cap.category_editing:true);
      this.newProducts=this.editingEnabled&&cap.new_products===true;
      this.imageEditing=this.requestImages&&cap.image_editing===true;
      this.existingItemsOnly=!(this.requestNewItems&&cap.new_items===true);
      if(!this.editingEnabled&&!this.publishingEnabled){
        const {data,error}=await this.client.rpc('chefduo_catalog_snapshot');if(error)throw Error('Published catalog is unavailable.');
        const published=await validateSnapshot(data,this.sequence||0);this.version=null;this.sequence=published.sequence;this.catalog=published.payload;
      }
    }
    if(this.editingEnabled||this.publishingEnabled){const r=await this.rpc('read');this.version=r.version;this.sequence=r.sequence;this.catalog=r.catalog;}
    return orderedCatalog(this.catalog);
  }
  view(){return orderedCatalog(this.catalog);}
  async save(table,payload,id,options={}){
    if(options.expectedVersion!==undefined&&options.expectedVersion!==this.version)throw Error('Draft changed. Reload before arranging items.');
    const key=tables[table];if(!key)throw Error('Unsupported catalog table');
    const catalog=structuredClone(this.catalog);
    const index=id?catalog[key].findIndex(r=>r.id===id):-1;
    if(key==='categories'&&!this.categoryEditing)throw Error('Category changes remain disabled.');
    if(key==='categories'&&index<0&&this.existingItemsOnly)throw Error('Adding categories is not enabled in this release.');
    if(key==='products'&&index<0&&!this.newProducts)throw Error('Adding products is disabled.');
    if(!this.imageEditing&&index>=0&&['image_url','image_path'].some(k=>Object.hasOwn(payload,k)&&payload[k]!==catalog[key][index]?.[k]))throw Error('Image references are locked in this release.');
    if(id&&index<0)throw Error('Refresh: draft item not found');
    const row=index<0?{id:crypto.randomUUID(),description:'',image_url:'/assets/product-placeholder.png',image_path:null,status:'hidden',sort_order:0,updated_at:new Date().toISOString(),...(key==='products'?{legacy_key:null,price_cents:0,variants:[],flavors:[],featured_order:null}:{}),...payload}:{...catalog[key][index],...payload};
    if(index<0){if(key==='products'&&!row.legacy_key)row.legacy_key='d1-'+row.id;catalog[key].push(row);}else catalog[key][index]=row;
    if(options.arrangement){if(key!=='products')throw Error('Product arrangement only.');applyProductOrder(catalog,{categoryId:row.category_id,ids:options.arrangement,sourceCategory:index>=0?this.catalog.products[index].category_id:null});}
    if(options.categoryArrangement){if(key!=='categories')throw Error('Category arrangement only.');applyCategoryOrder(catalog,options.categoryArrangement);}
    await this.rpc('save',catalog);await this.read();return row;
  }
  async arrangeProducts(categoryId,ids,expectedVersion){
    if(expectedVersion!==this.version)throw Error('Draft changed. Reload before arranging items.');
    if(!this.catalog.categories.some(c=>c.id===categoryId))throw Error('Category not found.');
    const next=structuredClone(this.catalog);applyProductOrder(next,{categoryId,ids});
    await this.rpc('save',next);await this.read();return this.view();
  }
  async arrangeCategories(ids,expectedVersion){
    if(!this.categoryEditing)throw Error('Category changes remain disabled.');
    if(expectedVersion!==this.version)throw Error('Draft changed. Reload before arranging categories.');
    const next=structuredClone(this.catalog);applyCategoryOrder(next,ids);
    await this.rpc('save',next);await this.read();return this.view();
  }
  async remove(table,item){
    if(item.status!=='archived')throw Error('Archive before removing from the draft. Published revisions remain preserved.');
    const key=tables[table],catalog=structuredClone(this.catalog);if(!key)throw Error('Unsupported catalog table');
    if(key==='categories'&&!this.categoryEditing)throw Error('Category changes remain disabled.');
    catalog[key]=catalog[key].filter(r=>r.id!==item.id);await this.rpc('save',catalog);await this.read();
  }
  async previewPublication(){return this.rpc('preview_publish');}
  async publish(){const r=await this.rpc('publish');await this.read();return r;}
  async events(){return this.rpc('events');}
  async published(){
    const {data,error}=await this.client.rpc('chefduo_catalog_snapshot');
    if(error)throw Error('The published menu could not be verified. Review was stopped.');
    const snapshot=await validateSnapshot(data,this.sequence||0);
    if(snapshot.state!=='available')throw Error('The published menu is unavailable. Review was stopped.');
    return snapshot;
  }
  async restore(eventId){await this.rpc('restore',{event_id:eventId});return this.read();}
  async upload(file, options){
    if(!this.imageEditing)throw Error('Image uploads and replacements are disabled.');
    return uploadImage(this.client,file,options);
  }
}
