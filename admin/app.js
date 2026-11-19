import {icon,addIcon,decorateControl} from './icons.js';
import {activityEntry,readableTime} from './activity-display.js';
import {categoryArrangement} from './category-arrangement.js';
import {updateNavIndicator,showNotification} from './micro-interactions.js';
import {createNavigation,adminRoute,singleFlightCache} from './navigation.js';
import {productArrangement} from './product-arrangement.js';
import {productPhoto} from './product-photo.js';
import {attachIdleSession,beginIdleSession} from './idle-session.js';
import {imageControls} from './image-upload.js';
import {privatePreview} from './private-images.js';
import {CatalogDrafts,parseCentavos} from "./catalog-drafts.js";
import {catalogChanges,oneStepRecovery,manilaDate} from "./draft-review.js";
import { bindImage } from "./images.js";
import { accountOperation, readConfig, connection, allowPreview, authorize, loadCatalog, result, upload, imageURL, money, root } from "./data.js";
const inviteParams = new URLSearchParams(location.hash.slice(1));
const invitationToken = inviteParams.get("token_hash");
if (invitationToken) history.replaceState(null, "", location.pathname + location.search);
const app = document.querySelector("#app");
const adminURL = new URL("admin/", root);
const preview = new URLSearchParams(location.search).get("preview") === "1";
const path = location.pathname.replace(adminURL.pathname, "").replace(/\/$/, "");
let route = path.replace(/\/index\.html$/, "").replace(/^index\.html$/, "");
let drafts;
let imageEditing = false, existingItemsOnly = true;
let idleSession;
let client, user, catalog = { products: [], categories: [] };
let navigation,renderSequence=0,checkedAt=0,accessPending=null,pageDirty=false;
const dirtyForms=new Set(),pageCleanup=[];
const catalogCache=singleFlightCache(async()=>{
  const identity=user?.id,store=drafts;
  const value=store?await store.read():await loadCatalog(client);
  if(idleSession?.locked||identity!==user?.id)return;
  catalog=value;if(store){imageEditing=store.imageEditing;existingItemsOnly=store.existingItemsOnly;}
},{maxAge:10000});
function hasUnsaved(){return pageDirty||[...dirtyForms].some(f=>f.isConnected&&!f.closest('dialog.is-closing'));}
function clearDirty(){pageDirty=false;dirtyForms.clear();}
function cleanupPage(){for(const fn of pageCleanup.splice(0)){try{fn();}catch{}}for(const d of document.querySelectorAll('dialog[open]'))d.close();clearDirty();}
function stopPrivateNavigation(){++renderSequence;navigation?.stop();catalogCache.clear();cleanupPage();catalog=null;drafts=null;user=null;}
async function ensureAccess(force=false){
  guardSession();if(!force&&performance.now()-checkedAt<30000)return;
  if(!accessPending)accessPending=(async()=>{const identity=user.id,current=await authorize(client);
    if(idleSession?.locked||user?.id!==identity)throw Error('Session changed. Sign in again.');
    if(!current||current.id!==identity){idleSession?.signedOut();stopPrivateNavigation();location.replace(new URL('login/',adminURL).href);throw Error('Access ended. Sign in again.');}
    if(user.adminRole!==current.adminRole)catalogCache.clear();user=current;checkedAt=performance.now();
  })().finally(()=>{accessPending=null;});return accessPending;
}
function updateNav(){
  const nav=app.querySelector('.nav');if(nav){const manage=[...nav.querySelectorAll('a')].find(a=>adminRoute(new URL(a.href),adminURL)==='admins');
    if(user?.adminRole!=='owner')manage?.remove();else if(!manage)nav.insertBefore(link('Manage admins',href('admins')),nav.querySelector('button'));
    const shellNode=app.querySelector('.shell');if(shellNode)shellNode.dataset.role=user?.adminRole||'preview';
    const pill=app.querySelector('.topbar .pill');if(pill)pill.textContent=preview?'Design preview':user?.adminRole==='owner'?'Owner / Super Admin':'Admin';
  }
  for(const a of app.querySelectorAll('.nav a')){const target=adminRoute(new URL(a.href),adminURL);const symbol=({'':'layout-dashboard',products:'package',categories:'tags','audit-logs':'history',settings:'user-round',admins:'users-round'})[target];if(symbol)addIcon(a,symbol);const active=target===route||target==='products'&&route.startsWith('products/');a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}updateNavIndicator(nav);}
async function navigate(href,options){if(navigation)return navigation.go(href,options);location.href=href;}

const e = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== void 0) n.textContent = text;
  return n;
};
const href = (route2 = "") => new URL(route2 + (route2 ? "/" : "") + (preview ? "?preview=1" : ""), adminURL).href;
const link = (label, to, cls = "button") => {
  const a = e("a", cls, label);
  a.href = to;
  return decorateControl(a,label);
};
function button(label, fn, cls = "") {
  const b = e("button", cls, label);
  b.type = "button";
  b.addEventListener('click',async()=>{
    if(b.disabled||b.dataset.pending)return;
    b.dataset.pending='true';b.setAttribute('aria-busy','true');
    try{await fn();}catch(error){fail(error);}finally{delete b.dataset.pending;b.removeAttribute('aria-busy');}
  });
  return decorateControl(b,label);
}
function toast(message,options) {
  return showNotification(e('div','toast',message),options);
}

function savedDraftNotice() {
  const n = e("div","toast");
  n.setAttribute("role","status");
  n.append(e("strong","","Saved as Draft " + drafts.version),
    e("p","","Your changes are saved, not live. Review the changes on the Dashboard before publishing."),
    link("Review on Dashboard",href(""),"button"));
  showNotification(n,{duration:12000,key:'Saved as Draft '+drafts.version});
}

function fail(error) {
  const message = error.message || "Something went wrong. Please try again.";
  const dialog = document.querySelector("dialog[open]");
  if (dialog) {
    let feedback = dialog.querySelector("[data-dialog-error]");
    if (!feedback) {
      feedback = e("p", "error");
      feedback.dataset.dialogError = "true";
      feedback.setAttribute("role", "alert");
      dialog.querySelector("form").prepend(feedback);
    }
    feedback.textContent = message;
    feedback.tabIndex = -1;
    feedback.focus();
  } else toast(message,{tone:'error'});
}
function field(label, type = "text", value = "", required = false) {
  const l = e("label", "", label), input = e(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") input.type = type;
  input.value = value ?? "";
  input.required = required;
  l.append(input);
  return { label: l, input };
}
function selectField(label, options, value) {
  const l = e("label", "", label), input = e("select");
  for (const [v, t] of options) {
    const o = e("option", "", t);
    o.value = v;
    input.append(o);
  }
  input.value = value;
  l.append(input);
  return { label: l, input };
}
function modal(title) {
  const returnFocus=document.activeElement;
  const d = e("dialog"), f = e("form");
  const heading2 = e("h2", "", title);
  heading2.id = "dialog-" + crypto.randomUUID();
  d.setAttribute("aria-labelledby", heading2.id);
  f.append(heading2);
  const close=d.close.bind(d);let closing=false;d.close=(value)=>{if(closing)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){close(value);return;}closing=true;d.classList.add('is-closing');setTimeout(()=>close(value),160);};
  d.append(f);
  document.body.append(d);
  d.addEventListener("cancel",event=>{event.preventDefault();d.close();});
  d.addEventListener("close", () => {d.remove();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});});
  d.showModal();
  return { d, f };
}
function status(value) {
  return e("span", "status " + value, value);
}
function previewNotice() {
  return e("div", "notice", "Design preview \xB7 Showing the existing public-menu snapshot. Changes cannot be saved here. No administrator session or database integration is simulated.");
}
async function refresh() {await catalogCache.read(true);}
function guardSession() {
  if(idleSession && !idleSession.check())throw Error("Session expired. Sign in again.");
  if(preview || !client || !user)throw new Error("An authorized staff session is required.");
}
function guardWrite() {
  guardSession();
  if (!drafts || drafts.editingEnabled===false) throw new Error("Catalog editing is not activated. No live catalog change was made.");
}
async function save(table, payload, id, stamp, options) {
  guardWrite();
  const row = await drafts.save(table,payload,id,options);
  catalogCache.fresh();clearDirty();
  catalog=drafts.view();
  idleSession?.saved();
  if(!idleSession?.locked)savedDraftNotice();
  return row;
}

async function refreshCommitted() {
  try {
    await refresh();
    return true;
  } catch {
    return false;
  }
}
async function remove(table, item) {
  guardWrite();
  const { d, f } = modal("Delete " + item.name + "?");
  f.append(e("p", "", "Remove this archived item from the draft only. Published revisions and recovery history are preserved. Type its exact name to confirm."));
  const confirm = field("Item name", "text", "", true);
  f.append(confirm.label);
  const row = e("div", "actions");
  row.append(button("Cancel", () => d.close()));
  const submit = e("button", "danger", "Remove from draft");
  submit.type = "submit";
  row.append(submit);
  f.append(row);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (confirm.input.value !== item.name) {
      confirm.input.setCustomValidity("Enter the exact item name.");
      confirm.input.reportValidity();
      return;
    }
    submit.disabled = true;
    try {
      await drafts.remove(table,item);
      catalog=drafts.view();
      const refreshed=true;
      d.close();
      render();
      if(refreshed)savedDraftNotice();else toast("Deletion saved, but refresh failed. Reload before another change.");
    } catch (err) {
      fail(err);
    } finally {
      submit.disabled = false;
    }
  };
  confirm.input.oninput = () => confirm.input.setCustomValidity("");
}
async function login() {
  app.replaceChildren();
  const wrap = e("main", "login-wrap"), card = e("section", "login");
  const brand = e("div", "brand");
  brand.append("Chef", e("span", "", "Duo"));
  card.append(brand, e("div", "eyebrow", "Menu Studio"), e("h1", "", "A fresh start for your menu."), e("p", "muted", "Sign in to manage your products, prices and categories."));
  const form = e("form"), email = field("Email address", "email", "", true), password = field("Password", "password", "", true);
  email.input.autocomplete = "username";
  email.input.maxLength = 254;
  email.input.inputMode = "email";
  password.input.autocomplete = "current-password";
  const submit = e("button", "primary", "Sign in");
  submit.type = "submit";
  submit.disabled = !client;
  const reveal = button("Show password", () => {
    const showing = password.input.type === "password";
    password.input.type = showing ? "text" : "password";
    reveal.textContent = showing ? "Hide password" : "Show password";
    reveal.setAttribute("aria-pressed", String(showing));
  });
  reveal.setAttribute("aria-pressed", "false");
  form.append(email.label, password.label, reveal, submit);
  card.append(form);
  const message = e("div");
  message.setAttribute("role", "alert");
  card.append(message);
  if (!client) card.append(e("div", "notice", "Admin access is not enabled yet. Your public menu is unchanged."));
  card.append(button("Forgot your password?", async () => {
    if (!client) throw new Error("Account recovery becomes available after secure setup.");
    if (!email.input.reportValidity()) return;
    result(await client.auth.resetPasswordForEmail(email.input.value, { redirectTo: new URL("recover/", adminURL).href }));
    toast("If this account can receive a recovery email, a link will be sent.");
  }));
  if (allowPreview) card.append(link("Preview the admin design", href("") + "?preview=1"));
  card.append(link("Back to public website", "https://chefduo.vercel.app/"));
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    submit.disabled = true;
    message.replaceChildren();
    try {
      result(await client.auth.signInWithPassword({ email: email.input.value, password: password.input.value }));
      user = await authorize(client);
      if (!user) {
        await client.auth.signOut();
        throw new Error("This account is not authorized to manage ChefDuo.");
      }
      location.href = href("");
    } catch (err) {
      message.className = "error";
      message.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  };
  wrap.append(card);
  app.append(wrap);
}
function shell() {
  const existing=app.querySelector('.shell');if(existing&&existing.dataset.role===(user?.adminRole||'preview')){updateNav();return existing.querySelector('main');}
  app.replaceChildren();
  const shell2 = e("div", "shell"), aside = e("aside");
  shell2.dataset.role=user?.adminRole||'preview';
  const brand = link("Chef", href(""), "brand");
  brand.append(e("span", "", "Duo"), e("small", "", "MENU STUDIO"));
  aside.append(brand);
  const nav = e("nav", "nav");
  nav.setAttribute("aria-label", "Administration");
  for (const [r, label] of [["", "Overview"], ["products", "Products"], ["categories", "Categories"], ["audit-logs", "Activity log"], ["settings", "Account"]]) nav.append(link(label, href(r), route === r || r === "products" && route.startsWith("products/") ? "active" : ""));
  if (user?.adminRole === "owner") nav.append(link("Manage admins", href("admins"), route === "admins" ? "active" : ""));
  nav.append(button("Sign out", async () => {
    if(idleSession) {idleSession.logout();return;}
    if (client) result(await client.auth.signOut({scope:"global"}));
    location.replace(new URL("login/", adminURL).href);
  }));
  aside.append(nav, e("p", "aside-bottom", "A good menu starts here.\nChefDuo \xB7 Product management"));
  const workspace = e("div", "workspace"), top = e("header", "topbar");
  top.append(e("span", "eyebrow", "Your kitchen. Your menu."), e("span", "pill", preview ? "Design preview" : user?.adminRole === "owner" ? "Owner / Super Admin" : "Admin"));
  const main = e("main");
  main.id = "content";
  workspace.append(top);
  if (preview) workspace.append(previewNotice());
  workspace.append(main);
  shell2.append(aside, workspace);
  app.append(shell2);updateNav();
  return main;
}
function heading(main, title, description, action) {
  const h = e("div", "heading"), t = e("div");
  t.append(e("h1", "", title), e("p", "", description));
  h.append(t);
  if (action) h.append(action);
  main.append(h);
}
function recent(logs) {
  const list=e('div','activity');
  if(!logs.length)list.append(e('div','empty',preview?'Activity will appear after account setup.':'No menu activity yet. Your next saved change will appear here.'));
  for(const row of logs)list.append(activityEntry(row,{viewer:user}));return list;
}
async function draftActivity(){return drafts.events();}

function changeSummary(field) {
  const {from,to}=field;
  const show=value=>value===undefined?"not set":value===null?"none":String(value);
  if(field.field==="price_cents") return "Price: " + (Number.isInteger(from)?money(from):"none") + " → " + (Number.isInteger(to)?money(to):"none");
  if(field.field==="status") return "Visibility: " + show(from) + " → " + show(to);
  if(field.field==="available") return "Availability: " + (from===false?"Unavailable":"Available") + " → " + (to===false?"Unavailable":"Available");
  if(field.field==="sort_order") return "Display order: " + show(from) + " → " + show(to);
  if(field.field==="name") return "Name: " + show(from) + " → " + show(to);
  if(field.field==="category_id") return "Category changed";
  if(field.field==="variants") return "Price options / variants changed";
  if(field.field==="image_url"||field.field==="image_path") return "Product image changed";
  if(field.field==="flavors") return "Flavors or sauces changed";
  if(field.field==="description") return "Description changed";
  return field.field.replaceAll("_"," ") + " changed";
}
async function showDraftChanges() {
  guardWrite();
  const version=drafts.version,sequence=drafts.sequence;
  const [published,events]=await Promise.all([drafts.published(),drafts.events()]);
  if(published.sequence!==sequence)throw Error("The live revision changed. Reload the Dashboard before reviewing.");
  const changes=catalogChanges(published.payload,drafts.catalog);
  const last=events.filter(row=>row.version===version).sort((a,b)=>b.id-a.id)[0];
  const {d,f}=modal("Review Draft "+version);
  f.append(e("p","muted","Draft "+version+" · "+(last?"Saved "+manilaDate(last.occurred_at):"Save date unavailable")+" · Live revision "+sequence));
  f.append(e("p","",changes.length?
    changes.length+" changed item"+(changes.length===1?"":"s")+" will be included in the next publication. All other products and categories stay unchanged.":
    "No unpublished changes. Your published menu is already up to date."));
  const review=e("div","activity");
  for(const change of changes){
    const row=e("article");
    row.append(e("strong","",change.type+" "+(change.section==="products"?"product":"category")+": "+change.name));
    if(change.type==="Added")row.append(e("p","muted","New item in draft"));
    if(change.type==="Removed")row.append(e("p","muted","Removed from draft"));
    for(const detail of change.fields)row.append(e("p","muted",changeSummary(detail)));
    review.append(row);
  }
  f.append(review,button("Close",()=>d.close()));
  if(changes.length){
    const action=button("Publish Draft "+version,async()=>{
      guardWrite();
      if(drafts.version!==version||drafts.sequence!==sequence)throw Error("The draft changed. Review it again before publishing.");
      if(!window.confirm('Publish Draft '+version+' to the live restaurant menu? Review the listed changes before confirming.'))return;
      action.disabled=true;
      try{
        await drafts.publish();
        await refresh();
        d.close();
        await render();
        toast("Draft "+version+" published successfully.");
      }catch(error){action.disabled=true;action.textContent='Publication not confirmed — reload and check the live revision before retrying';throw error;}
    },"primary");
    f.append(action);
  }
}
async function showDraftRecovery() {
  guardWrite();
  const version=drafts.version;
  const events=await drafts.events();
  const save=oneStepRecovery(events,version);
  const {d,f}=modal("Recover previous draft");
  if(save){
    const prior=events.filter(row=>row.version===version-1).sort((a,b)=>b.id-a.id)[0];
    f.append(e("p","","Restore Draft "+(version-1)),
      e("p","muted",prior?"Saved "+manilaDate(prior.occurred_at):"Previous draft saved before "+manilaDate(save.occurred_at)),
      e("p","muted","Restores the previous draft contents as a new version. Your published menu and full activity history stay unchanged."));
    const action=button("Restore Draft "+(version-1),async()=>{
      if(drafts.version!==version)throw Error("The draft changed. Reload before recovery.");
      action.disabled=true;
      try{
        await drafts.restore(save.id);
        await refresh();
        d.close();
        await render();
        toast("Previous draft recovered as Draft "+drafts.version+". It is not published.");
      }catch(error){action.disabled=false;throw error;}
    },"primary");
    f.append(action);
  }else f.append(e("p","muted","No immediately previous saved draft is available. Older events remain in the Activity log."));
  f.append(button("Close",()=>d.close()));
}

async function dashboard(main) {
  main.classList.add('overview-page');
  heading(main, "Your menu, at a glance.", "Keep every dish up to date, from wherever you are.", !drafts?.newProducts?e('p','notice','Adding products is disabled.'):link("+ Add product", href("products/new"), "button primary"));
  main.append(addIcon(e('p','staging-reminder','You’re managing the live restaurant menu. Saved edits stay in your draft until you publish.'),'info',20));
  const metrics = e("div", "metrics");
  for (const [label, value] of [["Total products", catalog.products.length], ["Published products", catalog.products.filter((p) => p.status === "published").length], ["Hidden / archived", catalog.products.filter((p) => p.status !== "published").length], ["Categories", catalog.categories.length]]) {
    const n = e("section", "metric");
    n.append(e("span", "", label), e("strong", "", String(value)),e("small","metric-caption",label==="Published products"?"Marked for publication in this draft":"In the current draft"));
    const symbol=({'Total products':'package','Published products':'eye','Hidden / archived':'eye-off','Categories':'layers'})[label];const badge=e('span','metric-icon');badge.setAttribute('aria-hidden','true');badge.append(icon(symbol,18));n.append(badge);
    metrics.append(n);
  }
  main.append(metrics);
  if(drafts?.editingEnabled || drafts?.publishingEnabled) {
    const panel=e("section","panel draft-panel");
    const badges=e('div','draft-badges');badges.append(e('span','','Draft '+drafts.version),e('span','','Live revision '+drafts.sequence));
    const draftHeading=addIcon(e('h2','','Menu draft'),'file-pen',20);draftHeading.classList.add('icon-heading');
    panel.append(draftHeading,badges,e('p','subtle','Saved changes stay in your draft until you review and publish them.'));
    const actions=e('div','actions');actions.append(button('Preview publication',showDraftChanges,'primary'));
    if(drafts.editingEnabled)actions.append(button('Recover previous draft',showDraftRecovery));
    panel.append(actions);
    if(!drafts.publishingEnabled)panel.append(e('p','notice','Publishing is currently paused. You can keep working on your draft.'));
    main.append(panel);
  } else main.append(e("p","notice","Catalog editing and publishing are disabled. The published customer menu remains available."));
  const grid = e("div", "two"), activity = e("section", "panel"), quick = e("section", "panel");
  activity.append(addIcon(e("h2", "icon-heading", "Recent menu activity"),"history",20), recent(preview ? [] : drafts && drafts.editingEnabled!==false ? (await draftActivity()).slice(0,5) : result(await client.from("menu_audit_logs").select("*").order("occurred_at", { ascending: false }).limit(5))));
  quick.append(e("div", "eyebrow", "Make something delicious"), e("h2", "", "A little update goes a long way."), e("p", "muted", "Refresh a price, add a new favorite or give your menu a new photograph."), link("Manage products", href("products"), "button primary"), e("p", "subtle", preview ? "Counts come from the current public-menu snapshot." : "Saving updates your draft. Review and publish when you are ready for customers to see it."), link("View public website \u2197", "https://chefduo.vercel.app/"));
  grid.append(activity, quick);
  main.append(grid);
}
function categoryOf(p) {
  return catalog.categories.find((c) => c.id === p.category_id || c.slug === p.category_slug);
}
async function quickPrice(item) {
  guardWrite();
  const { d, f } = modal("Quick price \xB7 " + item.name);
  const variants = item.variants.length ? item.variants : [{ name: "Price", price_cents: item.price_cents }];
  const fields = variants.map((v) => {
    const x = field(v.name + " (PHP)", "number", (v.price_cents / 100).toFixed(2).replace(/\.00$/, ""), true);
    x.input.min = "0";
    x.input.inputMode = "decimal";
    x.input.max = "1000000";
    x.input.step = ".01";
    f.append(x.label);
    return x;
  });
  const row = e("div", "actions");
  row.append(button("Cancel", () => d.close()));
  const submit = e("button", "primary", "Save price");
  submit.type = "submit";
  row.append(submit);
  f.append(row);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    submit.disabled = true;
    try {
      const payload = item.variants.length ? { variants: variants.map((v, i) => ({ ...v, price_cents: parseCentavos(fields[i].input.value) })) } : { price_cents: parseCentavos(fields[0].input.value) };
      await save("menu_products", payload, item.id, item.updated_at);
      d.close();
      render();
    } catch (err) {
      fail(err);
    } finally {
      submit.disabled = false;
    }
  };
}
async function products(main) {
  heading(main, "Products", "A place for every ChefDuo favorite.", !drafts?.newProducts?e('p','notice','Adding products is disabled.'):link("+ Add product", href("products/new"), "button primary"));
  const bar = e("div", "toolbar"), search = field("Search products", "search"), category = selectField("Category", [["", "All categories"], ...catalog.categories.map((c) => [c.id || c.slug, c.name])], ""), visibility = selectField("Visibility", [["", "All statuses"], ["published", "Published"], ["hidden", "Hidden"], ["archived", "Archived"]], "");
  search.input.placeholder = "Search by name\u2026";
  bar.append(search.label, category.label, visibility.label);
  const count = e("p", "list-count"), list = e("div", "product-list");
  main.append(bar, count, list);
  const draw = async () => {
    const filtered = catalog.products.filter((p) => p.name.toLowerCase().includes(search.input.value.toLowerCase()) && (!category.input.value || (p.category_id || p.category_slug) === category.input.value) && (!visibility.input.value || p.status === visibility.input.value));
    count.textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"}`;
    list.replaceChildren();
    if (!filtered.length) list.append(e("div", "empty", "No products match. Try a different search or filter."));
    for (const item of filtered) {
      const card = e("article", "product"), img = e("img");
      if (preview) img.src = new URL(item.image_url, root);
      else bindImage(img, client, item);
      img.alt = item.name;
      img.loading = "lazy";
      const info = e("div");
      const title = e("div", "title-line");
      title.append(e("h2", "", item.name), status(item.status));
      info.append(title, e("small", "", categoryOf(item)?.name || "Uncategorized"), e("small", "", item.price_cents !== null ? money(item.price_cents) : item.variants.map((v) => `${v.name}: ${money(v.price_cents)}`).join(" \xB7 ")));
      const actions = e("div", "row-actions");
      if(drafts?.editingEnabled!==false)actions.append(link("Edit", href("products/new") + (preview ? "&" : "?") + "id=" + encodeURIComponent(item.id || item.legacy_key)), button("Price", () => quickPrice(item)));
      if (!preview && drafts?.editingEnabled!==false) {
        actions.append(button(item.status === "published" ? "Hide in draft" : "Show in draft", async () => {
          await save("menu_products", { status: item.status === "published" ? "hidden" : "published" }, item.id, item.updated_at);
          render();
        }));
      }
      card.append(img, info, actions);
      list.append(card);
    }
  };
  for (const field2 of [search, category, visibility]) field2.input.addEventListener("input", draw);
  await draw();
}
async function editProduct(main) {
  const id = new URLSearchParams(location.search).get("id");
  const item = catalog.products.find((p) => (p.id || p.legacy_key) === id);
  if(!drafts?.newProducts&&!item)throw Error('Adding products is disabled.');
  if (id && !item) throw new Error("Product not found.");
  heading(main, item ? "Edit product" : "Add a new favorite", "Create and update your menu. Save when you’re ready.", link("\u2190 Products", href("products")));
  const form = e("form", "panel form-grid product-editor");
  const dirtyNote = e("p", "editor-state wide", "Changes are not saved yet.");
  dirtyNote.setAttribute("role", "status");
  let dirty = false;
  const leaveWarning = (event) => {
    if (dirty && !idleSession?.locked) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", leaveWarning);
  pageCleanup.push(()=>{window.removeEventListener("beforeunload",leaveWarning);imageControl?.dispose();arrangement?.dispose();});
  const markDirty = () => {
    dirty = true;pageDirty=true;
    dirtyNote.textContent = "Unsaved changes";
  };
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  const name = field("Product name", "text", item?.name || "", true);
  name.input.maxLength = 160;
  const category = selectField("Category", catalog.categories.map((c) => [c.id || c.slug, c.name]), item?.category_id || item?.category_slug || catalog.categories[0]?.id || catalog.categories[0]?.slug || "");
  category.input.required = true;
  const description = field("Description", "textarea", item?.description || "");
  description.label.classList.add("wide");
  description.input.maxLength = 2e3;
  const availability=selectField("Availability",[["yes","Available"],["no","Unavailable — omit from customer menu"]],item?.available===false?"no":"yes");
  const state = selectField("Visibility", [["hidden", "Hidden \u2014 draft"], ["published", "Published"], ["archived", "Archived"]], item?.status || "hidden");
  const mode = selectField("Pricing", [["base", "One price"], ["variants", "Multiple sizes / variants"]], item?.variants?.length ? "variants" : "base");
  const price = field("Price (PHP)", "number", item?.price_cents !== null && item?.price_cents !== void 0 ? (item.price_cents / 100).toFixed(2).replace(/\.00$/, "") : "");
  price.input.min = "0";
  price.input.step = ".01";
  price.input.inputMode = "decimal";
  price.input.max = "1000000";
  const variants = e("div", "wide field-group");
  const variantInputs = [];
  function addVariant(v = { name: "", price_cents: 0 },animate=false) {
    const row = e("div", "inline-fields");if(animate)row.classList.add('motion-in');
    const n = field("Size / variant", "text", v.name, true), p = field("Price (PHP)", "number", (v.price_cents / 100).toFixed(2).replace(/\.00$/, ""), true);
    p.input.min = "0";
    p.input.step = ".01";
    p.input.inputMode = "decimal";
    p.input.max = "1000000";
    n.input.maxLength = 120;
    row.append(n.label, p.label);
    const remove2 = button("Remove variant", () => {
      variantInputs.splice(variantInputs.findIndex((x) => x.row === row), 1);
      row.remove();
      markDirty();
    });
    row.append(remove2);
    n.input.disabled = p.input.disabled = mode.input.value === "base";
    variantInputs.push({ n, p, row });
    variants.insertBefore(row, variants.querySelector(":scope > button"));
  }
  for (const v of item?.variants || []) addVariant(v);
  const add = button("+ Add size / variant", () => {
    addVariant(undefined,true);
    markDirty();
  });
  variants.append(add);
  const flavors = field("Flavors & sauces \u2014 one per line", "textarea", (item?.flavors || []).join("\n"));
  flavors.label.classList.add("wide");
  const image = field("Product photo", "file");
  image.input.accept = "image/jpeg,image/png,image/webp";
  image.input.disabled = !imageEditing;
  if(!imageEditing)image.label.append(e("small","help",item ? "Image uploads are disabled. The existing photograph is kept." : "Image uploads are disabled. A default photo will be used."));
  image.label.classList.add("wide");
  const previewImg = e("img", "image-preview");
  previewImg.alt = "Product photograph preview";
  previewImg.hidden = !item;
  const productImageId=item?.id||crypto.randomUUID();
  let photoCanSave=true, saving=false, submit, imageControl, arrangement;
  const arrangementVersion=drafts.version;
  const updateSave=()=>{imageControl?.setSaving(saving);arrangement?.setDisabled(saving||preview||drafts?.editingEnabled===false);if(submit)submit.disabled=saving||!photoCanSave||preview||!drafts||!catalog.categories.length||drafts.editingEnabled===false;};
  imageControl=productPhoto({client,drafts,editable:imageEditing&&!preview&&drafts?.editingEnabled!==false,beforeUpload:guardSession,input:image.input,preview:previewImg,item,
    uploadScope:()=>({product:productImageId,operation:item?'replace':'create',version:drafts.version}),
    onState:s=>{photoCanSave=s.canSave;updateSave();},onChange:markDirty});
  const section=(title,subtitle)=>{const fieldset=e('fieldset','product-section');fieldset.append(e('legend','',title),e('p','section-description wide',subtitle));return fieldset;};
  const basic=section('Basic Information','Give your product a name and a place on the menu.');
  basic.append(name.label,category.label,description.label,flavors.label);
  const pricingSection=section('Pricing & Availability','Set prices and choose how this product appears.');
  pricingSection.append(mode.label,price.label,variants,availability.label,state.label);
  const photoSection=section('Product Photo','Optional. A clear photograph helps customers choose.');
  photoSection.append(imageControl.element);
  const arrangeSection=section('Product Arrangement','Choose where this product appears within its category.');
  arrangement=productArrangement({client,catalog,categoryId:category.input.value,edited:{...item,id:productImageId,name:name.input.value||'New product',status:state.input.value,available:availability.input.value==='yes',_unsaved:!item},onChange:markDirty});
  arrangeSection.append(arrangement.element);
  category.input.addEventListener('change',()=>{arrangement.setCategory(category.input.value);markDirty();});
  name.input.addEventListener('input',()=>arrangement.updateEdited({name:name.input.value||'New product'}));
  state.input.addEventListener('change',()=>arrangement.updateEdited({status:state.input.value}));
  availability.input.addEventListener('change',()=>arrangement.updateEdited({available:availability.input.value==='yes'}));
  form.append(basic,arrangeSection,pricingSection,photoSection);
  function pricing() {
    const base = mode.input.value === "base";
    price.label.hidden = !base;
    price.input.required = base;
    price.input.disabled = !base;
    variants.hidden = base;
    for (const x of variantInputs) {
      x.n.input.disabled = base;
      x.p.input.disabled = base;
    }
  }
  mode.input.onchange = ()=>{pricing();if(mode.input.value==='variants')variants.classList.add('motion-in');};
  pricing();
  const actions = e("div", "actions wide editor-actions");
  submit = e("button", "primary", preview ? "Saving unavailable in preview" : "Save product");
  submit.type = "submit";
  updateSave();
  actions.append(submit, link("Cancel", href("products")));
  if (item && !preview) {
    actions.append(button("Archive", async () => {
      await save("menu_products", { status: "archived" }, item.id, item.updated_at);
      await navigate(href("products"));
    }), button("Delete", () => {
      if (item.status !== "archived") throw new Error("Archive this product before deleting it.");
      return remove("menu_products", item);
    }, "danger"));
  }
  form.append(dirtyNote, actions);
  main.append(form);
  if(drafts?.editingEnabled===false){for(const input of form.querySelectorAll('input,textarea,select,button'))input.disabled=true;form.prepend(e('p','notice','Published catalog view. Editing and publishing are disabled.'));}
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    guardWrite();
    if (submit.disabled) return;
    saving=true;updateSave();
    let uploaded;
    try {
      const payload = { name: name.input.value.trim(), category_id: category.input.value, description: description.input.value.trim(), status: state.input.value, price_cents: mode.input.value === "base" ? parseCentavos(price.input.value) : null, variants: mode.input.value === "variants" ? variantInputs.map((x) => ({ name: x.n.input.value.trim(), price_cents: parseCentavos(x.p.input.value) })) : [], flavors: flavors.input.value.split("\n").map((v) => v.trim()).filter(Boolean) };
      if (!item || Object.hasOwn(item, "available")) payload.available = availability.input.value === "yes";
      if (mode.input.value === "variants" && !payload.variants.length) throw new Error("Add at least one price variant.");
      if(!item)payload.id=productImageId;
      uploaded = await imageControl.selectedURL();
      if(uploaded){payload.image_path=null;payload.image_url=uploaded;}
      if(!imageControl.element.isConnected)throw new DOMException('Save cancelled.', 'AbortError');
      await save("menu_products", payload, item?.id, item?.updated_at,{arrangement:arrangement.ids,expectedVersion:arrangementVersion});
      dirty = false;
      window.removeEventListener("beforeunload", leaveWarning);
      try{sessionStorage.setItem("chefduo-draft-saved",String(drafts.version));}catch{}
      await navigate(href("products"));
    } catch (err) {
      // A verified orphan upload is retained for later authorized, reference-aware GC.
      fail(err);
    } finally {
      saving=false;updateSave();
    }
  };
}
function categorySlug(name, id) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw Error('Invalid category identity.');
  const stem=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/g,'') || 'category';
  // The reserved category UUID also scopes its image ticket. A stable hidden
  // suffix avoids reusing links belonging to deleted or historical categories.
  return stem+'-'+id.replaceAll('-','');
}

async function categoryForm(item) {
  guardWrite();
  if(!drafts?.categoryEditing)throw Error('Category editing is disabled.');
  const categoryVersion=drafts.version;
  const { d, f } = modal(item ? "Edit category" : "New category");d.classList.add('category-editor-dialog');
  const name = field("Category name", "text", item?.name || "", true), description = field("Description", "textarea", item?.description || ""), state = selectField("Visibility", [["published", "Published"], ["hidden", "Hidden"], ["archived", "Archived"]], item?.status || "hidden"), image = field("Category photograph (max 5 MiB / 6 megapixels)", "file");
  image.input.accept = "image/jpeg,image/png,image/webp";
  image.input.disabled = !imageEditing;
  if(!imageEditing)image.label.append(e('small','help','Image uploads and replacements are disabled.'));
  const previewImg=e('img','image-preview');previewImg.hidden=!item;if(item)bindImage(previewImg,client,item);
  const categoryImageId=item?.id||crypto.randomUUID();
  const imageControl=await imageControls({client,drafts,input:image.input,preview:previewImg,item,catalog,product:true,category:true,uploadScope:()=>({kind:'category',product:categoryImageId,operation:item?'replace':'create',version:drafts.version})});
  image.label.append(imageControl.element,previewImg);

  const orderSection=e('fieldset','category-order-section');orderSection.append(e('legend','','Category Arrangement'));
  const categoryOrder=categoryArrangement({client,catalog,edited:{...item,id:categoryImageId,name:name.input.value||'New category',status:state.input.value,_unsaved:!item},onChange:()=>{dirtyForms.add(f);}});
  orderSection.append(categoryOrder.element);
  name.input.addEventListener('input',()=>categoryOrder.updateEdited({name:name.input.value||'New category'}));
  state.input.addEventListener('change',()=>categoryOrder.updateEdited({status:state.input.value}));
  d.addEventListener('close',()=>categoryOrder.dispose(),{once:true});
  f.append(name.label,description.label,state.label,image.label,orderSection);
  const actions = e("div", "actions category-modal-actions");
  const submit = e("button", "primary", "Save category");
  submit.type = "submit";
  submit.disabled = preview || !drafts;
  if(imageEditing)actions.append(button('Upload and preview',async()=>{
    guardSession();submit.disabled=true;
    try{const url=await imageControl.selectedURL();if(!url)throw Error('Choose a photograph first.');
      if(url==='/assets/product-placeholder.png')previewImg.src=url;
      else{const blob=await privatePreview(client,url);previewImg.src=blob;d.addEventListener('close',()=>URL.revokeObjectURL(blob),{once:true});}
      previewImg.hidden=false;toast('Photograph ready. Save category to attach it to the draft.');
    }catch(error){fail(error);}finally{submit.disabled=false;}
  }));
  actions.append(submit, button("Cancel", () => d.close()));
  if (item && !preview) actions.append(button("Delete", () => {
    if (item.status !== "archived") throw Error("Archive this category before deleting it.");
    if (catalog.products.some((p) => p.category_id === item.id)) throw new Error("Move or delete dependent products before deleting this category.");
    d.close();
    return remove("menu_categories", item);
  }, "danger"));
  f.append(actions);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if(submit.disabled)return;
    submit.disabled=true;categoryOrder.setDisabled(true);
    const pendingOrder=categoryOrder.ids;
    let uploaded;
    try {
      guardWrite();
      const payload = { name: name.input.value.trim(), description: description.input.value.trim(), status: state.input.value };
      if (!item) {payload.slug = categorySlug(payload.name,categoryImageId);payload.id=categoryImageId;}
      uploaded = await imageControl.selectedURL();
      if(uploaded){payload.image_path=null;payload.image_url=uploaded;}
      if(!imageControl.element.isConnected)throw new DOMException('Save cancelled.', 'AbortError');
      await save("menu_categories", payload, item?.id, item?.updated_at,{categoryArrangement:pendingOrder,expectedVersion:categoryVersion});
      // Immutable images and previous revisions are retained; never delete on replacement.
      d.close();
      render();
    } catch (err) {
      // A verified orphan upload is retained for later authorized, reference-aware GC.
      fail(err);
    } finally {
      submit.disabled = false;categoryOrder.setDisabled(false);
    }
  };
}
async function arrangeCategoryProducts(category){
  guardWrite();const version=drafts.version;
  const {d,f}=modal('Arrange products — '+category.name);
  const arrangement=productArrangement({client,catalog,categoryId:category.id,onChange:()=>{dirtyForms.add(f);}});
  f.append(arrangement.element);
  const actions=e('div','actions'),submit=e('button','primary','Save arrangement');submit.type='submit';
  actions.append(submit,button('Cancel',()=>d.close()));f.append(actions);
  d.addEventListener('close',()=>arrangement.dispose(),{once:true});
  f.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;guardWrite();submit.disabled=true;arrangement.setDisabled(true);
    try{await drafts.arrangeProducts(category.id,arrangement.ids,version);catalog=drafts.view();catalogCache.fresh();clearDirty();idleSession?.saved();d.close();await render();savedDraftNotice();}
    catch(error){fail(error);submit.textContent='Not confirmed — reload before retrying';}
  };
}
async function arrangeCategories(){
  guardWrite();if(!drafts.categoryEditing)throw Error('Category editing is disabled.');
  const version=drafts.version,{d,f}=modal('Arrange Categories');d.classList.add('category-arrange-dialog');
  const feedback=e('p','category-order-feedback','No order changes yet.');feedback.setAttribute('role','status');
  const actions=e('div','actions category-modal-actions'),submit=e('button','primary','Save Order');submit.type='submit';submit.disabled=true;
  const order=categoryArrangement({client,catalog,onChange:()=>{dirtyForms.add(f);feedback.textContent='Unsaved order changes';submit.disabled=false;}});
  actions.append(feedback,submit,button('Cancel',()=>d.close()));f.append(order.element,actions);d.addEventListener('close',()=>order.dispose(),{once:true});
  f.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;guardWrite();submit.disabled=true;order.setDisabled(true);
    try{await drafts.arrangeCategories(order.ids,version);catalog=drafts.view();catalogCache.fresh();clearDirty();idleSession?.saved();d.close();await render();savedDraftNotice();}
    catch(error){fail(error);feedback.textContent='Order not confirmed. Reload before trying again.';submit.textContent='Not confirmed — reload before retrying';}
  };
}
async function categories(main) {
  const categoryActions=e('div','category-page-actions');
  if(drafts?.categoryEditing&&!preview){if(!drafts.existingItemsOnly)categoryActions.append(button('+ Add category',()=>categoryForm(),'primary'));categoryActions.append(button('Arrange Categories',arrangeCategories));}
  else categoryActions.append(e('p','notice','Category changes remain disabled.'));
  heading(main,'Categories','Organize your menu. Keep familiar links working.',categoryActions);
  const grid = e("div", "category-grid");
  for (const item of catalog.categories) {
    const card = e("article", "category-card"), img = e("img");
    if (preview) img.src = new URL(item.image_url, root);
    else bindImage(img, client, item);
    img.alt = item.name;
    const body = e("div", "body");
    body.append(e("h2", "", item.name), status(item.status), e("p", "subtle", `${catalog.products.filter((p) => (p.category_id || p.category_slug) === (item.id || item.slug)).length} products \xB7 Order ${item.sort_order}`));
    if (drafts?.categoryEditing) body.append(button("Edit category", () => categoryForm(item)));
    if(drafts?.editingEnabled&&!preview)body.append(button("Arrange products",()=>arrangeCategoryProducts(item)));
    card.append(img, body);
    grid.append(card);
  }
  if (!catalog.categories.length) grid.append(e("div", "empty", "No categories yet. Add a category before adding products."));
  main.append(grid);
}
async function audit(main) {
  main.classList.add('audit-page');
  heading(main, "Activity log", "See what changed, who made the change, and when. Times are shown in Philippine time. Times shown in Asia/Manila.");
  if(drafts && drafts.editingEnabled!==false){main.append(recent(await draftActivity()),e('p','subtle','Showing the latest 100 menu events. Open View details to review the original recorded information.'));return;}
  const panel = e("section", "panel");
  let page = 0;
  const list = e("div");
  const more = button("Load more", async () => {
    page++;
    await draw();
  });
  async function draw() {
    const rows = preview ? [] : result(await client.from("menu_audit_logs").select("*").order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(page * 25, page * 25 + 24));
    list.append(recent(rows));
    more.hidden = rows.length < 25;
  }
  panel.append(list, more);
  main.append(panel);
  await draw();
}
async function settings(main) {
  heading(main, "Your account", "Keep access to your menu secure.");
  const panel = e("section", "panel field-group");
  panel.append(e("h2", "", "Administrator account"), e("p", "long", preview ? "No account connected in design preview" : user.email), e("p", "muted", "Access is granted explicitly in the database. Signing in alone does not grant menu-management permissions."));
  const form = e("form", "field-group"), password = field("New password", "password", "", true), confirm = field("Confirm password", "password", "", true);
  password.input.minLength = 12;
  password.input.autocomplete = confirm.input.autocomplete = "new-password";
  const submit = e("button", "primary", "Change password");
  submit.type = "submit";
  submit.disabled = preview;
  const currentPassword = field("Current password (if requested)", "password");
  currentPassword.input.autocomplete = "current-password";
  const nonce = field("Email verification code (if requested)", "text");
  nonce.input.autocomplete = "one-time-code";
  nonce.input.inputMode = "numeric";
  const verify = button("Send verification code", async () => {
    guardSession();
    result(await client.auth.reauthenticate());
    toast("Check your email for a verification code.");
  });
  verify.disabled = preview;
  form.append(
    password.label,
    confirm.label,
    currentPassword.label,
    verify,
    nonce.label,
    e("p", "help", "Your security settings may require your current password or an email code. A valid recovery session is checked by Supabase."),
    submit
  );
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (password.input.value !== confirm.input.value) {
      confirm.input.setCustomValidity("Passwords must match.");
      confirm.input.reportValidity();
      return;
    }
    submit.disabled = true;
    try {
      guardSession();
      const change = { password: password.input.value };
      if (currentPassword.input.value) change.current_password = currentPassword.input.value;
      if (nonce.input.value.trim()) change.nonce = nonce.input.value.trim();
      result(await client.auth.updateUser(change));
      form.reset();
      toast("Password changed. Other sessions may remain active; sign out globally if needed.");
    } catch (err) {
      fail(err);
    } finally {
      submit.disabled = false;
    }
  };
  confirm.input.oninput = () => confirm.input.setCustomValidity("");
  panel.append(form, e("p", "subtle", "Use a unique password of at least 12 characters. Recovery uses a verified email link; email delivery and allowed redirect URLs must be configured in Supabase."), button(preview ? "Exit preview" : "Sign out", async () => {
    if (client) result(await client.auth.signOut());
    location.href = new URL("login/", adminURL).href;
  }));
  main.append(panel);
}
async function render({before,valid=()=>true}={}) {
  if(idleSession?.locked)return;
  const ticket=++renderSequence,currentRoute=route,main=shell(),stage=e('div','page-content');
  if(before)stage.classList.add('route-enter');
  main.inert=true;main.setAttribute('aria-busy','true');
  let loading=main.querySelector('.page-loading');if(!loading){loading=e('p','page-loading','Loading…');loading.setAttribute('role','status');main.prepend(loading);}
  try{
    if(before)await before();if(ticket!==renderSequence||!valid()||idleSession?.locked)return;
    if(!currentRoute)await dashboard(stage);
    else if(currentRoute==='products')await products(stage);
    else if(currentRoute==='products/new')await editProduct(stage);
    else if(currentRoute==='categories')await categories(stage);
    else if(currentRoute==='audit-logs')await audit(stage);
    else if(currentRoute==='settings')await settings(stage);
    else if(currentRoute==='admins')await manageAdmins(stage);
    else stage.append(e('h1','','Page not found'),link('Return to overview',href('')));
  }catch(error){
    stage.replaceChildren(e('section','page-error'));
    stage.firstChild.append(e('h1','','This page could not be loaded'),e('p','error',error.message),button('Try again',()=>render({before:async()=>{await ensureAccess(true);await refresh();}})));
  }finally{
    if(ticket===renderSequence&&valid()&&!idleSession?.locked){main.replaceChildren(stage);main.inert=false;main.removeAttribute('aria-busy');updateNav();if(before){const h=main.querySelector('h1');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}}
  }
}
function installNavigation(){
  navigation=createNavigation({base:adminURL,guard:()=>!idleSession?.locked&&!!user,
    canLeave:()=>!hasUnsaved()||window.confirm('Leave this page? Unsaved changes will be discarded.'),
    onNavigate:async(url,isCurrent)=>{
      cleanupPage();route=adminRoute(url,adminURL);updateNav();
      await render({valid:isCurrent,before:async()=>{await ensureAccess(route==='admins');if(!isCurrent())return;if(!['settings','admins'].includes(route))await catalogCache.read(route==='products/new');}});
    }});
  const dirty=event=>{const form=event.target.closest?.('form');if(form&&!form.closest('.login'))dirtyForms.add(form);};
  document.addEventListener('input',dirty);document.addEventListener('change',dirty);
  window.addEventListener('beforeunload',event=>{if(hasUnsaved()&&!idleSession?.locked){event.preventDefault();event.returnValue='';}});
}
async function start() {
  try {
    const editingConfig=await readConfig(false);
    client = await connection(false,editingConfig);
    imageEditing=editingConfig.imageEditing===true;
    existingItemsOnly=editingConfig.existingItemsOnly===true;
    if(client && editingConfig.catalogEditing === "atomic-v1") drafts=new CatalogDrafts(client,{imageEditing,existingItemsOnly,capabilityRead:editingConfig.capabilityRead===true});
    if (preview && !allowPreview) throw new Error("Design preview is available only in the local development checkout.");
    if (preview) {
      catalog = await (await fetch(new URL("admin/catalog-snapshot.json", root))).json();
      await render();
      return;
    }
    if (route === "recover") {
      await recoverPassword();
      return;
    }
    if (route === "accept") {
      await acceptInvitation();
      return;
    }
    if (route === "login") {
      await login();
      return;
    }
    if (!client) {
      location.replace(new URL("login/", adminURL));
      return;
    }
    user = await authorize(client);
    if (!user) {
      await client.auth.signOut();
      location.replace(new URL("login/", adminURL));
      return;
    }
    checkedAt=performance.now();
    idleSession=attachIdleSession({client,user,app,loginURL:new URL("login/",adminURL).href});
    if(idleSession.locked)return;
    client.auth.onAuthStateChange((event,session) => {
      if(event === "SIGNED_OUT"){if(!idleSession.locked)idleSession.signedOut();stopPrivateNavigation();location.replace(new URL("login/",adminURL));}
      else if(session?.user?.id&&user&&session.user.id!==user.id){idleSession.signedOut();stopPrivateNavigation();location.replace(new URL("login/",adminURL));}
    });
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden && idleSession.check()) {
        try {
          const current = await authorize(client);
          if (!current) {
            await client.auth.signOut();
            location.replace(new URL("login/", adminURL));
          } else {if(user?.adminRole!==current.adminRole)catalogCache.clear();user=current;checkedAt=performance.now();updateNav();if(route==='admins'&&user.adminRole!=='owner'){cleanupPage();await render();}}
        } catch {
          toast("Access could not be checked. Protected changes still require server authorization.");
        }
      }
    });
    shell();installNavigation();
    await render({before:async()=>{if(!['settings','admins'].includes(route))await refresh();}});
    idleSession.finishLocalRender();
    try{if(sessionStorage.getItem("chefduo-draft-saved")){sessionStorage.removeItem("chefduo-draft-saved");savedDraftNotice();}}catch{}
  } catch (err) {
    app.replaceChildren(e("p", "error", err.message), link("Return to sign in", new URL("login/", adminURL).href));
  }
}
start();
async function confirmAction(title, message, perform) {
  const { d, f } = modal(title);
  f.append(e("p", "", message));
  const row = e("div", "actions");
  const cancel = button("Cancel", () => d.close());
  const submit = e("button", "primary", "Confirm");
  submit.type = "submit";
  row.append(cancel, submit);
  f.append(row);
  f.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const outcome = await perform();
      d.close();
      await render();
      toast(outcome?.session_cleanup_required ? "Access blocked. Have the target privately sign out globally before restoring access." : "Account access updated.");
    } catch (error) {
      fail(error);
    } finally {
      submit.disabled = false;
    }
  };
}
function promotionControl(promote, ownerSeats, userId) {
  if (ownerSeats.active + ownerSeats.reserved < ownerSeats.limit) return promote;
  promote.disabled = true;
  const blocked = e("span", "promotion-blocked");
  blocked.tabIndex = 0;
  blocked.setAttribute("role", "group");
  blocked.setAttribute("aria-label", "Promote to Super Admin, unavailable");
  const explanation = ownerSeats.active >= ownerSeats.limit
    ? "Cannot promote as of this moment. Maximum of 2 Super Admins. Demote one first."
    : "Cannot promote right now. A pending invitation holds the remaining Super Admin seat.";
  const tooltip = e("span", "promotion-tooltip", explanation);
  tooltip.id = "promotion-unavailable-" + userId;
  tooltip.setAttribute("role", "tooltip");
  blocked.setAttribute("aria-describedby", tooltip.id);
  blocked.append(promote, tooltip);
  return blocked;
}
async function manageAdmins(main) {
  if (!preview && user?.adminRole !== "owner") throw new Error("Only an active Owner can manage administrators.");
  main.classList.add('admins-page');
  heading(main,'Manage admins','Manage account access and Super Admin seats. Each person uses their own sign-in.');
  main.append(addIcon(e('p','invitation-notice','Account changes affect live administrator access. Check the account and role before confirming.'),'info',20));
  const inviteAction=button('+ Invite account',inviteAdmin,'primary');main.querySelector('.heading').append(inviteAction);
  if (preview) {
    main.append(e("div", "empty", "Owner-only page preview. No account information or sample identities are shown. Sign-in and server authorization are required for management."));
    return;
  }
  const data = await accountOperation(client, { action: "list" }), list = e("div", "account-list");
  const ownerCount = data.members.filter((m) => m.role === "owner" && m.status === "active").length;
  const reservedOwners = data.invitations.filter(i => i.requested_role === "owner" && ["provisioning", "sent", "failed"].includes(i.status)).length;
  const ownerSeats = data.owner_capacity ?? {active:ownerCount,reserved:reservedOwners,limit:2};
  const full=ownerSeats.active+ownerSeats.reserved>=ownerSeats.limit;
  const seatsNotice=e('section','seat-notice');seatsNotice.setAttribute('role','status');
  seatsNotice.append(e('strong','','Super Admin seats: '+ownerSeats.active+' of '+ownerSeats.limit+' occupied'),e('p','',full?'All seats are occupied or reserved. Promotion is unavailable until a seat is free.':'Super Admin seats are available for authorized promotions.'));
  if(ownerSeats.reserved)seatsNotice.append(e('p','',ownerSeats.reserved+' seat(s) reserved for pending invitations.'));
  addIcon(seatsNotice,full?'triangle-alert':'users-round',20);main.append(seatsNotice);
  for (const item of [...data.members, ...data.invitations.map((i) => ({ ...i, role: i.requested_role || i.role || "admin", invitation_status: i.status, status: i.status, added_at: i.created_at, invitation_id: i.id }))]) {
    const card = e("article", "panel account-card");
    const badges=e('div','account-badges');badges.append(e('span','role-badge',item.role==='owner'?'Super Admin':'Admin'),e('span','status '+item.status,({active:'Active',disabled:'Disabled',invited:'Invited',revoked:'Access revoked',sent:'Invitation sent',failed:'Needs attention',provisioning:'Preparing invitation'})[item.status]||'Status unavailable'));
    const meta=e('dl','account-meta');meta.append(e('dt','','Invitation'),e('dd','',({sent:'Email requested',provisioning:'Preparing',failed:'Request failed',accepted:'Accepted',revoked:'Canceled'})[item.invitation_status]||'No pending invitation'),e('dt','','Added'),e('dd','',readableTime(item.added_at,{dateOnly:true})));
    card.append(e('h2','long',item.email),badges,meta);
    const actions=e('div','actions');
    const act=(label,action,extra={})=>{const control=button(label,()=>confirmAction(label,'Confirm this change for '+item.email+'. Access changes apply to subsequent protected operations.',()=>accountOperation(client,{action,target:item.user_id,...extra})));
      if(action==='revoke')control.classList.add('danger');else if(action==='disable'||action==='role'&&extra.role==='admin')control.classList.add('action-caution');return control;};
    if (["invited", "failed", "sent", "provisioning"].includes(item.status)) actions.append(button("Resend invitation", () => confirmAction("Resend invitation", "A new email will be requested. Wait at least 60 seconds between requests.", () => accountOperation(client, { action: "resend", email: item.email, role: item.requested_role || item.role || "admin" }))));
    if (item.role === "owner" && item.status === "active" && ownerCount === 1) card.append(e("p", "account-protection", "This is the last active Super Admin. Add another authorized Super Admin before changing this account’s access."));
    if (item.status === "active" && !(item.role === "owner" && ownerCount === 1)) {
      actions.append(act("Disable admin", "disable"));
      if (item.role === "owner") actions.append(act("Demote to Admin", "role", { role: "admin" }));
      else actions.append(promotionControl(act("Promote to Super Admin", "role", { role: "owner" }), ownerSeats, item.user_id));
    }
    if (item.status === "disabled") {
      card.append(e("p","help","Before restoring access, have this account sign out globally and confirm its sessions are cleared."));
      actions.append(act("Restore access", "restore"));
    }
    if (item.invitation_id && ["failed", "sent", "provisioning"].includes(item.invitation_status || item.status)) actions.append(button("Cancel invitation", () => confirmAction("Cancel invitation", "Any email already queued cannot be recalled; account access will remain blocked.", () => accountOperation(client, { action: "cancel_invite", invitation: item.invitation_id }))));
    if (item.user_id && item.status !== "revoked" && !(item.role === "owner" && item.status === "active" && ownerCount === 1)) actions.append(act("Revoke access", "revoke"));
    card.append(actions);
    list.append(card);
  }
  if (!data.members.length && !data.invitations.length) list.append(e("div", "empty", "Administrator accounts will appear here after initial setup."));
  main.append(list);
  const activity = e("section", "panel activity-panel");
  activity.append(addIcon(e("h2", "icon-heading", "Administrator activity"),"history",20),e("p","help","Account access history. Times are shown in Philippine time."));
  const rows = result(await client.from("admin_audit_logs").select("*").order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(50));
  if (!rows.length) activity.append(e("p", "muted", "No administrator-management activity yet."));
  const entries=e('div','activity');for(const row of rows)entries.append(activityEntry(row,{viewer:user,actors:data.members}));activity.append(entries);
  main.append(activity);
}
function inviteAdmin() {
  guardSession();
  if (user?.adminRole !== "owner") throw new Error("Owner access required.");
  const { d, f } = modal("Invite account");
  const email = field("Administrator email", "email", "", true);
  email.input.autocomplete = "off";
  email.input.maxLength = 254;
  const roleLabel = e("label", "", "Account role"), role = e("select");
  for (const [value, title] of [["admin", "Admin"], ["owner", "Owner"]]) { const option = e("option", "", title); option.value = value; role.append(option); }
  role.value = "admin"; roleLabel.append(role);
  f.append(email.label, roleLabel, e("p", "help", "The recipient privately verifies the invitation and chooses a password. Owner invitations reserve one of two seats; no account is silently downgraded to Admin. Capacity and authorization are checked by the server."));
  const actions = e("div", "actions");
  const submit = e("button", "primary", "Send invitation");
  submit.type = "submit";
  actions.append(submit, button("Cancel", () => d.close()));
  f.append(actions);
  f.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await accountOperation(client, { action: "invite", email: email.input.value.trim(), role: role.value });
      d.close();
      await render();
      toast("Invitation requested. Check delivery status with your email provider.");
    } catch (error) {
      fail(error);
    } finally {
      submit.disabled = false;
    }
  };
}
async function acceptInvitation() {
  app.replaceChildren();
  const wrap = e("main", "login-wrap"), card = e("section", "login");
  card.append(e("h1", "", "Set up your ChefDuo password"), e("p", "muted", "Complete your invitation using your own password."));
  wrap.append(card);
  app.append(wrap);
  if (!client) {
    card.append(e("p", "notice", "Invitation setup is not enabled yet."));
    return;
  }
  if (invitationToken) {
    result(await client.auth.verifyOtp({ token_hash: invitationToken, type: "invite" }));
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    card.append(e("p", "error", "This invitation is invalid or expired. Ask the Owner to resend it."), link("Sign in", new URL("login/", adminURL).href));
    return;
  }
  const own = result(await client.rpc("chefduo_admin_context"));
  if (own?.status !== "invited") {
    card.append(e("p", "error", "No pending invitation is ready for this account. Ask the Owner to check its status."), link("Sign in", new URL("login/", adminURL).href));
    return;
  }
  const form = e("form"), password = field("New password", "password", "", true), confirm = field("Confirm password", "password", "", true);
  password.input.minLength = 12;
  password.input.autocomplete = confirm.input.autocomplete = "new-password";
  const submit = e("button", "primary", "Set password and activate");
  submit.type = "submit";
  form.append(password.label, confirm.label, submit);
  card.append(form);
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (password.input.value !== confirm.input.value) {
      confirm.input.setCustomValidity("Passwords must match.");
      confirm.input.reportValidity();
      return;
    }
    submit.disabled = true;
    try {
      await accountOperation(client, { action: "accept", password: password.input.value });
      result(await client.auth.signOut());
      location.replace(new URL("login/", adminURL).href);
    } catch (error2) {
      fail(error2);
    } finally {
      submit.disabled = false;
    }
  };
  confirm.input.oninput = () => confirm.input.setCustomValidity("");
}
async function recoverPassword() {
  app.replaceChildren();
  const wrap = e("main", "login-wrap"), card = e("section", "login");
  wrap.append(card);
  app.append(wrap);
  card.append(e("h1", "", "Reset your password"));
  if (!client) {
    card.append(e("p", "notice", "Recovery is not enabled yet."));
    return;
  }
  if (!invitationToken) {
    card.append(e("p", "error", "Open a valid password-recovery email link."));
    return;
  }
  result(await client.auth.verifyOtp({ token_hash: invitationToken, type: "recovery" }));
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Recovery link is invalid or expired.");
  const form = e("form"), password = field("New password", "password", "", true), confirm = field("Confirm password", "password", "", true);
  password.input.minLength = 12;
  password.input.autocomplete = confirm.input.autocomplete = "new-password";
  const submit = e("button", "primary", "Save new password");
  submit.type = "submit";
  form.append(password.label, confirm.label, submit);
  card.append(form);
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (password.input.value !== confirm.input.value) {
      confirm.input.setCustomValidity("Passwords must match.");
      confirm.input.reportValidity();
      return;
    }
    submit.disabled = true;
    try {
      result(await client.auth.updateUser({ password: password.input.value }));
      result(await client.auth.signOut());
      location.replace(new URL("login/", adminURL).href);
    } catch (error2) {
      fail(error2);
    } finally {
      submit.disabled = false;
    }
  };
  confirm.input.oninput = () => confirm.input.setCustomValidity("");
}
