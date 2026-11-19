export const orderedProducts=rows=>[...rows].sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id));
export function createArrangementModel(products,edited=null){
  const source=structuredClone(products),lists=new Map();let category;
  function select(id){
    if(category!==id)lists.clear();
    category=id;
    if(!lists.has(id)){
      const rows=orderedProducts(source.filter(p=>p.category_id===id));
      if(edited){const index=rows.findIndex(p=>p.id===edited.id);if(index>=0)rows[index]={...rows[index],...edited};else rows.push({...edited,category_id:id});}
      lists.set(id,rows);
    }
  }
  return {select,get category(){return category;},get rows(){return [...(lists.get(category)||[])];},get ids(){return this.rows.map(r=>r.id);},
    move(id,position){const rows=lists.get(category);if(!rows)return false;const from=rows.findIndex(r=>r.id===id);if(from<0||!Number.isInteger(position)||position<0||position>=rows.length)return false;const [row]=rows.splice(from,1);rows.splice(position,0,row);return true;},
    updateEdited(patch){if(!edited)return;Object.assign(edited,patch);for(const rows of lists.values()){const row=rows.find(r=>r.id===edited.id);if(row)Object.assign(row,patch);}}
  };
}
export function applyProductOrder(catalog,{categoryId,ids,sourceCategory=null}){
  const rows=catalog.products.filter(p=>p.category_id===categoryId);
  if(!Array.isArray(ids)||ids.length!==rows.length||new Set(ids).size!==ids.length||rows.some(p=>!ids.includes(p.id)))throw Error('Product arrangement changed. Reload and arrange the category again.');
  const positions=new Map(ids.map((id,index)=>[id,index]));
  for(const row of rows)row.sort_order=positions.get(row.id);
  if(sourceCategory&&sourceCategory!==categoryId)orderedProducts(catalog.products.filter(p=>p.category_id===sourceCategory)).forEach((row,index)=>{row.sort_order=index;});
  return catalog;
}
