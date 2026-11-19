export function applyCategoryOrder(catalog,ids){
  if(!Array.isArray(ids)||ids.length!==catalog.categories.length||new Set(ids).size!==ids.length||catalog.categories.some(c=>!ids.includes(c.id)))throw Error('Category lineup changed. Reload before arranging categories.');
  const positions=new Map(ids.map((id,index)=>[id,index]));
  for(const category of catalog.categories)category.sort_order=positions.get(category.id);
  return catalog;
}
