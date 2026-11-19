import {icon} from './icons.js';
const indicators=new WeakMap();
export function updateNavIndicator(nav){
  if(!nav)return;
  let entry=indicators.get(nav);
  if(!entry){
    const marker=document.createElement('span');marker.className='nav-indicator';marker.setAttribute('aria-hidden','true');nav.prepend(marker);
    entry={marker,pending:false};indicators.set(nav,entry);
    entry.observer=new ResizeObserver(()=>place(true));entry.observer.observe(nav);
  }
  function place(snap=false){
    entry.snap=entry.snap||snap;if(entry.pending)return;entry.pending=true;
    requestAnimationFrame(()=>{entry.pending=false;if(!nav.isConnected){entry.observer.disconnect();return;}
      const active=nav.querySelector('a[aria-current="page"]');entry.marker.hidden=!active;if(!active)return;
      const bounds=nav.getBoundingClientRect(),rect=active.getBoundingClientRect();
      const key=[rect.left-bounds.left,rect.top-bounds.top,rect.width,rect.height].map(v=>Math.round(v*10)/10).join(':');
      if(entry.key===key){entry.snap=false;return;}
      const snapNow=entry.snap;entry.snap=false;if(snapNow)entry.marker.style.transition='none';
      entry.marker.style.width=rect.width+'px';entry.marker.style.height=rect.height+'px';
      entry.marker.style.transform='translate3d('+(rect.left-bounds.left)+'px,'+(rect.top-bounds.top)+'px,0)';
      if(snapNow)requestAnimationFrame(()=>{entry.marker.style.transition='';});
      if(!entry.key)requestAnimationFrame(()=>entry.marker.classList.add('is-ready'));entry.key=key;
    });
  }
  place();
}

export function showNotification(node,{tone='success',duration,key=node.textContent}={}){
  const existing=document.querySelector('.toast');
  if(existing?.dataset.noticeKey===key&&existing.dataset.tone===tone&&!existing.classList.contains('is-leaving')){existing.refreshLifetime?.();return existing;}
  existing?.dismissNotice?.(true);if(existing?.isConnected)existing.remove();
  const symbol=icon(tone==='error'?'triangle-alert':'circle-check',20);symbol.classList.add('notice-icon');node.prepend(symbol);node.classList.add('with-notice-icon');
  node.classList.add('toast');node.dataset.tone=tone;node.dataset.noticeKey=key;
  node.setAttribute('role',tone==='error'?'alert':'status');node.setAttribute('aria-atomic','true');
  const close=document.createElement('button');close.type='button';close.className='toast-dismiss';close.textContent='×';close.setAttribute('aria-label','Dismiss notification');node.append(close);
  const previousFocus=document.activeElement,lifetime=duration??(tone==='error'?0:Math.max(8000,Math.min(14000,key.length*45)));
  let timer,remaining=lifetime,started=0,closed=false;
  function pause(){clearTimeout(timer);if(started){remaining=Math.max(0,remaining-(performance.now()-started));started=0;}}
  function resume(){if(closed||!lifetime||document.hidden||node.matches(':hover')||node.contains(document.activeElement))return;clearTimeout(timer);started=performance.now();timer=setTimeout(()=>dismiss(),remaining);}
  function dismiss(immediate=false){if(closed)return;closed=true;pause();document.removeEventListener('visibilitychange',visibility);
    const focused=node.contains(document.activeElement);const remove=()=>{node.remove();if(focused&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});};
    if(immediate||matchMedia('(prefers-reduced-motion: reduce)').matches)remove();else{node.classList.add('is-leaving');setTimeout(remove,160);}
  }
  function visibility(){if(document.hidden)pause();else resume();}
  node.dismissNotice=dismiss;node.refreshLifetime=()=>{pause();remaining=lifetime;resume();};close.onclick=()=>dismiss();
  node.addEventListener('pointerenter',pause);node.addEventListener('pointerleave',resume);node.addEventListener('focusin',pause);node.addEventListener('focusout',()=>queueMicrotask(resume));document.addEventListener('visibilitychange',visibility);
  document.body.append(node);resume();return node;
}
