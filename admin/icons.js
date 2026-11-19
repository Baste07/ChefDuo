// Small local outline set. No library, font, CDN, remote SVG or user-supplied markup.
const shapes={
  'layout-dashboard':[['rect',{x:3,y:3,width:7,height:10,rx:1}],['rect',{x:14,y:3,width:7,height:6,rx:1}],['rect',{x:3,y:17,width:7,height:4,rx:1}],['rect',{x:14,y:13,width:7,height:8,rx:1}]],
  package:[['path',{d:'M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z M3.5 7.5 12 12l8.5-4.5 M12 12v9 M8 5.1l8.5 4.5'}]],
  tags:[['path',{d:'m3 3 8 .1 10 10-8 8L3 11V3Z M15 3l7 7'}],['circle',{cx:7.5,cy:7.5,r:.6}]],
  history:[['path',{d:'M3.5 10A8.5 8.5 0 1 1 5 17.5 M3 4v6h6 M12 7v5l3 2'}]],
  'user-round':[['circle',{cx:12,cy:7,r:4}],['path',{d:'M4 21v-2a8 8 0 0 1 16 0v2'}]],
  'users-round':[['circle',{cx:9,cy:7,r:3.5}],['path',{d:'M2 21v-2a7 7 0 0 1 14 0v2 M16 3.5a3.5 3.5 0 0 1 0 7 M22 21v-2a7 7 0 0 0-4-6.3'}]],
  'log-out':[['path',{d:'M9 4H4v16h5 M9 12h12 M17 8l4 4-4 4'}]],
  eye:[['path',{d:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z'}],['circle',{cx:12,cy:12,r:3}]],
  'eye-off':[['path',{d:'m3 3 18 18 M9.6 5.3A12 12 0 0 1 12 5c6.5 0 10 7 10 7a21 21 0 0 1-3.1 4 M6 6.1A22 22 0 0 0 2 12s3.5 7 10 7c1.5 0 2.8-.3 4-.8 M10 10a3 3 0 0 0 4 4'}]],
  layers:[['path',{d:'m12 3 10 5-10 5L2 8l10-5Z M2 12l10 5 10-5 M2 16l10 5 10-5'}]],
  'file-pen':[['path',{d:'M13 3H5v18h8 M13 3v6h6V9l-6-6Z m3 11 2 2 M13 20l1-4 5-5 3 3-5 5-4 1Z'}]],
  'rotate-ccw':[['path',{d:'M3 10a9 9 0 1 1 2 9 M3 4v6h6'}]],
  plus:[['path',{d:'M12 5v14 M5 12h14'}]],
  info:[['circle',{cx:12,cy:12,r:9}],['path',{d:'M12 11v6 M12 7h.01'}]],
  'triangle-alert':[['path',{d:'m12 3 10 18H2L12 3Z M12 9v5 M12 17h.01'}]],
  'circle-check':[['circle',{cx:12,cy:12,r:9}],['path',{d:'m7.5 12 3 3 6-6'}]],
  trash:[['path',{d:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7'}]]
};
export const iconNames=Object.freeze(Object.keys(shapes));
export function icon(name,size=20){
  if(!Object.hasOwn(shapes,name))throw Error('Unknown interface icon.');
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.75,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'ui-icon'}))svg.setAttribute(key,String(value));
  svg.dataset.icon=name;
  for(const [tag,attrs] of shapes[name]){const child=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))child.setAttribute(key,String(value));svg.append(child);}return svg;
}
export function addIcon(node,name,size=18){if(!node.querySelector(':scope > .ui-icon'))node.prepend(icon(name,size));node.classList.add('with-icon');return node;}
export function decorateControl(node,label){
  const name=({'Preview publication':'eye','Recover previous draft':'rotate-ccw','+ Add product':'plus','+ Add category':'plus','Manage products':'package','Arrange products':'layout-dashboard','Arrange Categories':'layers','Sign out':'log-out','Revoke access':'trash'})[label];
  if(name){if(label.startsWith('+ '))node.textContent=label.slice(2);addIcon(node,name);}return node;
}
