import {createArrangementModel} from './product-order.js';
import {bindImage} from './images.js';

export function productArrangement({client,catalog,categoryId,edited=null,labels={},onChange=()=>{}}){
  const model=createArrangementModel(catalog.products,edited);model.select(categoryId);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const root=el('div','product-arrangement'),list=el('ol','arrangement-list'),empty=el('p','help'),status=el('p','arrangement-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const help=el('p','help',labels.help||'Drag products or use the arrow buttons. Hidden items stay visible here. Changes apply only when you save. Changing category resets the pending lineup.');
  const positionLabel=el('label','arrangement-position',labels.position||'Place this product'),position=el('select');positionLabel.append(position);positionLabel.hidden=!edited;position.setAttribute('aria-label',labels.positionAria||'Position for this product');
  root.append(help,positionLabel,empty,list,status);let disabled=false,dragged=null;const cache=new Map(),rowMotion=new Map();
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const img=entry.target;observer.unobserve(img);bindImage(img,client,img._product);}} ,{root:list,rootMargin:'80px'}):null;
  function move(id,index,focusAction){if(disabled||!model.move(id,index))return;render();if(focusAction){const v=cache.get(id);const b=v[focusAction];(b.disabled?(v.up.disabled?v.down:v.up):b).focus();}const row=model.rows.find(r=>r.id===id);status.textContent=(row?.name||'Product')+' moved to position '+(index+1)+'.';onChange();}
  function render(){
    const oldPositions=new Map();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const [id,v] of cache)if(v.node.isConnected){const rect=v.node.getBoundingClientRect();if(rect.bottom>=0&&rect.top<innerHeight)oldPositions.set(id,rect.top);}
    for(const animation of rowMotion.values())animation.cancel();rowMotion.clear();
    const rows=model.rows;empty.textContent=edited&&rows.length===1?(labels.emptyEdited||'No other products in this category. This product will appear first.'):(labels.empty||'This category has no products yet.');empty.hidden=rows.length>0&&!(edited&&rows.length===1);list.hidden=!rows.length;
    position.replaceChildren();rows.forEach((row,index)=>{const o=el('option','',String(index+1)+' of '+rows.length);o.value=String(index);position.append(o);if(row.id===edited?.id)position.value=String(index);});
    // Setting selected value after all options avoids browsers defaulting to first.
    if(edited)position.value=String(rows.findIndex(r=>r.id===edited.id));position.disabled=disabled;
    for(const [index,row] of rows.entries()){
      let view=cache.get(row.id);
      if(!view){
        const node=el('li','arrangement-row'),number=el('span','arrangement-number'),img=el('img','arrangement-thumb'),info=el('div','arrangement-info'),name=el('strong'),badge=el('span','arrangement-badge'),actions=el('div','arrangement-actions');img.alt='';img.width=44;img.height=44;img.loading='lazy';
        const up=el('button','','↑'),down=el('button','','↓');up.type=down.type='button';actions.append(up,down);info.append(name,badge);node.append(number,img,info,actions);
        up.onclick=()=>move(row.id,model.ids.indexOf(row.id)-1,'up');down.onclick=()=>move(row.id,model.ids.indexOf(row.id)+1,'down');
        node.addEventListener('dragstart',event=>{if(disabled){event.preventDefault();return;}dragged=row.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-chefduo-product',row.id);node.classList.add('is-dragging');});
        node.addEventListener('dragend',()=>{dragged=null;node.classList.remove('is-dragging');for(const v of cache.values())v.node.classList.remove('is-drop-target');});
        node.addEventListener('dragover',event=>{if(!disabled&&dragged){event.preventDefault();if(dragged!==row.id)node.classList.add('is-drop-target');}});
        node.addEventListener('dragleave',event=>{if(!node.contains(event.relatedTarget))node.classList.remove('is-drop-target');});
        node.addEventListener('drop',event=>{event.preventDefault();if(!disabled&&dragged&&event.dataTransfer.getData('application/x-chefduo-product')===dragged)move(dragged,model.ids.indexOf(row.id));dragged=null;for(const v of cache.values())v.node.classList.remove('is-drop-target');});
        view={node,number,img,name,badge,up,down};cache.set(row.id,view);
        img._product=row;if(!row._unsaved){if(observer)observer.observe(img);else bindImage(img,client,row);}else img.src='/assets/product-placeholder.png';
      }
      view.node.classList.toggle('is-current',row.id===edited?.id);view.node.draggable=!disabled;view.number.textContent=String(index+1);view.name.textContent=row.name||'Untitled product';
      const visibility=row.status==='published'?'Published':row.status==='archived'?'Archived':'Hidden';view.badge.textContent=(row._unsaved?(labels.unsaved||'Unsaved product')+' · ':'')+visibility+(row.available===false?' · Unavailable':'')+(row._detail?' · '+row._detail:'');
      view.up.disabled=disabled||index===0;view.down.disabled=disabled||index===rows.length-1;view.up.setAttribute('aria-label','Move '+(row.name||'product')+' up');view.down.setAttribute('aria-label','Move '+(row.name||'product')+' down');list.append(view.node);
    }
    const ids=new Set(rows.map(r=>r.id));for(const node of [...list.children])if(!ids.has([...cache.entries()].find(([,v])=>v.node===node)?.[0]))node.remove();
    for(const [id,top] of oldPositions){const node=cache.get(id)?.node;if(node?.isConnected&&node.animate){const dy=top-node.getBoundingClientRect().top;if(dy)rowMotion.set(id,node.animate([{transform:'translateY('+dy+'px)'},{transform:'none'}],{duration:180,easing:'ease-out'}));}}
  }
  position.onchange=()=>{if(edited)move(edited.id,Number(position.value));};render();
  window.addEventListener('pagehide',()=>observer?.disconnect(),{once:true});
  return {element:root,get ids(){return model.ids;},get categoryId(){return model.category;},setCategory(id){model.select(id);render();},updateEdited(patch){model.updateEdited(patch);render();},setDisabled(value){if(disabled===value)return;disabled=value;render();},dispose(){observer?.disconnect();for(const a of rowMotion.values())a.cancel();rowMotion.clear();}};
}
