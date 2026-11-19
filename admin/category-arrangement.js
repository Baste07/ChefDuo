import {productArrangement} from './product-arrangement.js';

export function categoryArrangement({client,catalog,edited=null,onChange=()=>{}}){
  const count=id=>catalog.products.filter(p=>p.category_id===id).length;
  const detail=id=>{const n=count(id);return n+' '+(n===1?'product':'products');};
  // UI-only adapter: reuse the proven list/motion/accessibility component.
  // Only the real category IDs leave this adapter; no product data is saved.
  const rows=catalog.categories.map(c=>({...c,category_id:'category-lineup',_detail:detail(c.id)}));
  const current=edited?{...edited,category_id:'category-lineup',_detail:detail(edited.id)}:null;
  const view=productArrangement({client,catalog:{products:rows},categoryId:'category-lineup',edited:current,onChange,
    labels:{position:'Place this category',positionAria:'Position for this category',unsaved:'Unsaved category',empty:'No categories yet.',emptyEdited:'This is your first category. It will appear first.',help:'Drag categories or use the arrow buttons. Hidden categories are included. The order changes only when you save.'}});
  view.element.classList.add('category-arrangement');view.element.querySelector('ol').setAttribute('aria-label','Category order');
  return view;
}
