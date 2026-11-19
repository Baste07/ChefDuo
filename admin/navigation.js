const routes=new Set(['','products','products/new','categories','audit-logs','settings','admins']);
export function adminRoute(url,base){
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||url.hash)return null;
  const route=url.pathname.slice(base.pathname.length).replace(/\/$/,'').replace(/\/index\.html$/,'').replace(/^index\.html$/,'');
  return routes.has(route)?route:null;
}
export function createNavigation({base,onNavigate,canLeave=()=>true,guard=()=>true,win=window,doc=document}){
  let serial=0,stopped=false,current=new URL(win.location.href),index=Number(win.history.state?.chefduoPage)||0,suppress=false;
  const scroll=new Map();win.history.replaceState({...win.history.state,chefduoPage:index},'',current.href);win.history.scrollRestoration='manual';
  async function go(href,{pop=false,replace=false}={}){
    const url=new URL(href,current);if(stopped||adminRoute(url,base)===null||!guard())return false;
    if(url.href===current.href&&!pop)return false;
    if(!canLeave()){
      if(pop){const next=Number(win.history.state?.chefduoPage);if(Number.isFinite(next)&&next!==index){suppress=true;win.history.go(index-next);}else win.history.pushState({chefduoPage:index},'',current.href);}
      return false;
    }
    scroll.set(index,{x:win.scrollX,y:win.scrollY});
    if(pop)index=Number(win.history.state?.chefduoPage)||0;
    else{index=replace?index:index+1;win.history[replace?'replaceState':'pushState']({chefduoPage:index},'',url.href);}
    current=url;const ticket=++serial,isCurrent=()=>!stopped&&ticket===serial;
    await onNavigate(url,isCurrent);
    if(isCurrent()){const point=pop?scroll.get(index):null;win.scrollTo(point?.x||0,point?.y||0);}
    return true;
  }
  const click=event=>{
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const a=event.target.closest?.('a[href]');if(!a||a.target&&a.target!=='_self'||a.hasAttribute('download'))return;
    const url=new URL(a.href,current);if(adminRoute(url,base)===null)return;
    event.preventDefault();go(url.href).catch(()=>{});
  };
  const pop=()=>{if(suppress){suppress=false;return;}go(win.location.href,{pop:true}).catch(()=>{});};
  doc.addEventListener('click',click);win.addEventListener('popstate',pop);
  return {go,stop(){stopped=true;++serial;scroll.clear();doc.removeEventListener('click',click);win.removeEventListener('popstate',pop);}};
}

// Memory only, per authenticated application lifetime; rejected work is not cached.
export function singleFlightCache(load,{maxAge=10000,now=()=>performance.now()}={}){
  let pending=null,stamp=-Infinity,generation=0;
  return {async read(force=false){if(pending)return pending;if(!force&&now()-stamp<maxAge)return;
    const g=generation;pending=Promise.resolve().then(load).then(value=>{if(g===generation)stamp=now();return value;}).finally(()=>{pending=null;});return pending;},
    fresh(){stamp=now();},clear(){++generation;stamp=-Infinity;}};
}
