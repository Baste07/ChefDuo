export function readableTime(value,{dateOnly=false}={}){
  if(!value)return 'Date unavailable';const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Date unavailable';
  return new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',...(dateOnly?{}:{timeStyle:'short'}),timeZone:'Asia/Manila'}).format(date);
}
const role=value=>value==='owner'?'Super Admin':value==='admin'?'Admin':'account role';
export function describeActivity(row){
  const action=String(row.action||'').toUpperCase(),entity=String(row.entity_type||'').split('.').pop(),before=row.before_value||{},after=row.after_value||{};
  if(action==='DRAFT_SAVE')return {title:'Saved draft changes',summary:'Changes were saved to the draft menu. They are not live until published.',tone:'draft'};
  if(['DRAFT_RESTORE','RESTORE'].includes(action))return {title:'Restored a previous draft',summary:'A previous draft was restored for review. This did not publish the menu.',tone:'draft'};
  if(action==='PUBLISH')return {title:'Published menu update',summary:'The menu was published to the restaurant customer website.',tone:'published'};
  if(action==='PRIVATE_IMAGE_VERIFIED')return {title:'Photo uploaded and verified',summary:'A photo was checked and is ready to use in a draft.',tone:'photo'};
  if(entity==='admin_members'){
    if(action==='INSERT')return {title:'Added an administrator',summary:'An administrator account was added to the access list.',tone:'access'};
    if(action==='DELETE'||['REVOKE','REVOKED'].includes(action)||action==='UPDATE'&&after.status==='revoked'&&before.status!==after.status)return {title:'Removed admin access',summary:'This account no longer has administrator access.',tone:'warning'};
    if(action==='UPDATE'){
      if(after.status==='disabled'&&before.status!==after.status)return {title:'Disabled admin access',summary:'Administrator access was paused for this account.',tone:'warning'};
      if(after.status==='active'&&['disabled','revoked'].includes(before.status))return {title:'Restored admin access',summary:'This account can access the Admin system again.',tone:'access'};
      if(before.role&&after.role&&before.role!==after.role)return {title:'Changed administrator role',summary:'The account role changed from '+role(before.role)+' to '+role(after.role)+'.',tone:'access'};
      return {title:'Updated admin access',summary:'An administrator account’s access information changed.',tone:'access'};
    }
  }
  if(entity==='admin_invitations'){
    if(action==='INSERT')return {title:'Created an admin invitation',summary:'An invitation record was prepared. This does not confirm email delivery.',tone:'access'};
    if(action==='DELETE')return {title:'Removed an admin invitation',summary:'An invitation record was removed.',tone:'warning'};
    if(action==='UPDATE'){
      const labels={sent:['Invitation email requested','The email request was submitted. Delivery is not confirmed here.'],failed:['Invitation request failed','The invitation needs attention before it can be completed.'],accepted:['Invitation accepted','The recipient completed the invitation.'],revoked:['Invitation canceled','This invitation can no longer be accepted.'],provisioning:['Preparing an invitation','The invitation is being prepared.']};
      if(before.status!==after.status&&labels[after.status])return {title:labels[after.status][0],summary:labels[after.status][1],tone:after.status==='failed'||after.status==='revoked'?'warning':'access'};
      return {title:'Updated an admin invitation',summary:'An invitation’s information changed.',tone:'access'};
    }
  }
  const item=entity==='menu_categories'?'category':entity==='menu_products'?'product':null;
  if(item&&['INSERT','UPDATE','DELETE'].includes(action))return {title:({INSERT:'Added a ',UPDATE:'Updated a ',DELETE:'Removed a '})[action]+item,summary:((after.name||before.name)?'“'+(after.name||before.name)+'” — ':'')+'The '+item+' information changed.',tone:'draft'};
  return {title:'Recorded an administrative change',summary:'Open the details to review the original event information.',tone:'neutral'};
}
export function actorName(row,{viewer,actors=[]}={}){
  if(row.actor_id&&row.actor_id===viewer?.id)return 'You';
  const known=actors.find(a=>a.user_id===row.actor_id);if(known?.email)return known.email;
  if(row.actor_email&&!/^Staff\s+[a-f0-9-]{36}$/i.test(row.actor_email))return row.actor_email;
  return row.actor_id?'Another administrator':'System setup';
}
export function activityChanges(row){
  const before=row.before_value&&typeof row.before_value==='object'?row.before_value:{},after=row.after_value&&typeof row.after_value==='object'?row.after_value:{};
  const changes=[],add=(label,from,to)=>changes.push({label,before:from,after:to});
  const text=value=>typeof value==='string'?value.slice(0,180):value===null?'None':String(value);
  const status=value=>({active:'Active',disabled:'Disabled',revoked:'Access removed',invited:'Invited',hidden:'Hidden',published:'Published',archived:'Archived',sent:'Email requested',accepted:'Accepted',failed:'Needs attention',provisioning:'Preparing'})[value]||'Updated status';
  for(const [key,label] of [['version','Draft version'],['draft_version','Draft version'],['sequence','Published revision']])if(Object.hasOwn(before,key)&&Object.hasOwn(after,key)&&before[key]!==after[key])add(label,text(before[key]),text(after[key]));
  if(!changes.length&&row.action==='DRAFT_SAVE'&&Number.isInteger(row.version))add('Saved as',null,'Draft '+row.version);
  const catalog=value=>{for(const candidate of [value,value.catalog,value.payload])if(candidate&&Array.isArray(candidate.products)&&Array.isArray(candidate.categories))return candidate;return null;};
  const oldCatalog=catalog(before),newCatalog=catalog(after);
  if(oldCatalog&&newCatalog){
    for(const [key,noun] of [['products','Product'],['categories','Category']]){
      const oldRows=new Map(oldCatalog[key].map(r=>[r.id,r])),newRows=new Map(newCatalog[key].map(r=>[r.id,r]));
      const added=[...newRows.values()].filter(r=>!oldRows.has(r.id)),removed=[...oldRows.values()].filter(r=>!newRows.has(r.id));
      const names=rows=>rows.length===1?rows[0].name||noun:rows.length+' '+(key==='categories'?'categories':'products');
      if(added.length)add(added.length===1?noun+' added':key==='categories'?'Categories added':'Products added',null,names(added));
      if(removed.length)add(removed.length===1?noun+' removed':key==='categories'?'Categories removed':'Products removed',names(removed),'Removed from draft');
      let reordered=0;const updated=[];
      for(const [id,next] of newRows){const old=oldRows.get(id);if(!old)continue;
        if(old.sort_order!==next.sort_order)reordered++;
        const fields=key==='products'?['name','description','status','available','category_id','price_cents','variants','flavors','image_url','image_path']:['name','description','status','image_url','image_path'];
        if(fields.some(field=>JSON.stringify(old[field])!==JSON.stringify(next[field])))updated.push(next);
      }
      if(updated.length)add(updated.length===1?noun+' updated':key==='categories'?'Categories updated':'Products updated',null,names(updated));
      if(reordered)add(key==='categories'?'Category order':'Product arrangement',null,reordered+' item'+(reordered===1?'':'s')+' repositioned');
    }
  }else{
    for(const [key,label] of [['name','Name'],['description','Description'],['role','Role'],['status','Status'],['enabled','Access enabled'],['available','Available'],['price_cents','Price'],['sort_order','Position']]){
      if(!Object.hasOwn(before,key)&&!Object.hasOwn(after,key)||JSON.stringify(before[key])===JSON.stringify(after[key]))continue;
      const display=value=>value===undefined?'Not set':key==='role'?role(value):key==='status'?status(value):['enabled','available'].includes(key)?value===true?'Yes':value===false?'No':'Not set':key==='price_cents'?Number.isInteger(value)?new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value/100):'No fixed price':key==='sort_order'?Number.isInteger(value)&&value>=0?String(value+1):'Not set':text(value);
      add(label,display(before[key]),display(after[key]));
    }
    if(before.image_url!==after.image_url&&(before.image_url||after.image_url))add('Photo',before.image_url?'Previous photo':'No photo',!after.image_url||after.image_url==='/assets/product-placeholder.png'?'No photo':'Updated photo');
    for(const [key,label] of [['variants','Pricing options'],['flavors','Flavors and sauces']])if(JSON.stringify(before[key])!==JSON.stringify(after[key])&&(Object.hasOwn(before,key)||Object.hasOwn(after,key)))add(label,null,'Updated');
  }
  if(changes.length>12)return [...changes.slice(0,11),{label:'Additional changes',before:null,after:'Open Technical details for the complete system record.'}];
  return changes.length?changes:[{label:'Summary',before:null,after:'No simplified comparison is available for this event. The system record is below.'}];
}
export function activityEntry(row,options={}){
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const description=describeActivity(row),entry=el('article','activity-entry activity-card');entry.dataset.tone=description.tone;
  const title=el('h3','activity-title',description.title),summary=el('p','activity-summary',description.summary),meta=el('div','activity-meta');
  const time=el('time','',readableTime(row.occurred_at));if(row.occurred_at&&Number.isFinite(new Date(row.occurred_at).getTime()))time.dateTime=new Date(row.occurred_at).toISOString();time.title='Philippine time (Asia/Manila)';
  const who=el('span','activity-actor'),when=el('span');who.append(el('span','activity-meta-label','Who'),document.createTextNode(actorName(row,options)));when.append(el('span','activity-meta-label','When'),time);meta.append(who,when);
  const toggle=el('button','activity-expand'),toggleText=el('span','','Show details'),icon=el('span','activity-expand-icon','+');toggle.type='button';icon.setAttribute('aria-hidden','true');toggle.append(toggleText,icon);
  const panel=el('div','activity-change-panel');panel.id='activity-'+crypto.randomUUID();panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',panel.id);
  const list=el('dl','activity-change-list');for(const change of activityChanges(row)){const item=el('div','activity-change-item'),value=el('dd');
    if(change.before!==null&&change.before!==undefined)value.append(el('span','activity-before',change.before),el('span','activity-change-arrow','→'));
    value.append(el('span','activity-after',change.after));item.append(el('dt','',change.label),value);list.append(item);
  }
  const technical=el('details','activity-technical');technical.append(el('summary','','Technical details'),el('pre','audit-values',JSON.stringify({event:row.action,record:row.entity_type,actor:row.actor_id,recorded_at:row.occurred_at,before:row.before_value,after:row.after_value},null,2)));
  panel.append(el('h4','','What changed'),list,technical);let motion,serial=0;
  toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true',token=++serial;motion?.cancel();toggle.setAttribute('aria-expanded',String(open));toggleText.textContent=open?'Hide details':'Show details';icon.textContent=open?'−':'+';
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||!panel.animate){panel.hidden=!open;return;}
    panel.hidden=false;motion=panel.animate(open?[{opacity:0,transform:'translateY(-3px)'},{opacity:1,transform:'none'}]:[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(-3px)'}],{duration:open?180:150,easing:'ease-out'});
    motion.finished.then(()=>{if(token===serial)panel.hidden=!open;}).catch(()=>{});
  });
  entry.append(title,summary,meta,toggle,panel);return entry;
}
