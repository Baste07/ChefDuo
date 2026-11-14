import {CatalogDrafts,parseCentavos} from "./catalog-drafts.js";
import { bindImage } from "./images.js";
import { accountOperation, readConfig, connection, allowPreview, authorize, loadCatalog, result, upload, imageURL, money, root } from "./data.js";
const inviteParams = new URLSearchParams(location.hash.slice(1));
const invitationToken = inviteParams.get("token_hash");
if (invitationToken) history.replaceState(null, "", location.pathname + location.search);
const app = document.querySelector("#app");
const adminURL = new URL("admin/", root);
const preview = new URLSearchParams(location.search).get("preview") === "1";
const path = location.pathname.replace(adminURL.pathname, "").replace(/\/$/, "");
const route = path.replace(/\/index\.html$/, "").replace(/^index\.html$/, "");
let drafts;
let client, user, catalog = { products: [], categories: [] };
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
  return a;
};
function button(label, fn, cls = "") {
  const b = e("button", cls, label);
  b.type = "button";
  b.addEventListener("click", () => Promise.resolve().then(fn).catch(fail));
  return b;
}
function toast(message) {
  document.querySelector(".toast")?.remove();
  const n = e("div", "toast", message);
  n.setAttribute("role", "status");
  document.body.append(n);
  setTimeout(() => n.remove(), 6e3);
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
  } else toast(message);
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
  const d = e("dialog"), f = e("form");
  const heading2 = e("h2", "", title);
  heading2.id = "dialog-" + crypto.randomUUID();
  d.setAttribute("aria-labelledby", heading2.id);
  f.append(heading2);
  d.append(f);
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return { d, f };
}
function status(value) {
  return e("span", "status " + value, value);
}
function previewNotice() {
  return e("div", "notice", "Design preview \xB7 Showing the existing public-menu snapshot. Changes cannot be saved here. No administrator session or database integration is simulated.");
}
async function refresh() {
  catalog = drafts ? await drafts.read() : await loadCatalog(client);
}
function guardSession() {
  if(preview || !client || !user)throw new Error("An authorized staff session is required.");
}
function guardWrite() {
  guardSession();
  if (!drafts) throw new Error("Catalog editing is not activated. No live catalog change was made.");
}
async function save(table, payload, id, stamp) {
  guardWrite();
  const row = await drafts.save(table,payload,id);
  catalog=structuredClone(drafts.catalog);
  toast("Draft saved. Customer prices change only after a complete revision is published.");
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
      catalog=structuredClone(drafts.catalog);
      const refreshed=true;
      d.close();
      render();
      toast(refreshed ? "Item deleted." : "Deleted. Catalog refresh failed; reload before another change.");
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
  app.replaceChildren();
  const shell2 = e("div", "shell"), aside = e("aside");
  const brand = link("Chef", href(""), "brand");
  brand.append(e("span", "", "Duo"), e("small", "", "MENU STUDIO"));
  aside.append(brand);
  const nav = e("nav", "nav");
  nav.setAttribute("aria-label", "Administration");
  for (const [r, label] of [["", "Overview"], ["products", "Products"], ["categories", "Categories"], ["audit-logs", "Activity log"], ["settings", "Account"]]) nav.append(link(label, href(r), route === r || r === "products" && route.startsWith("products/") ? "active" : ""));
  if (user?.adminRole === "owner") nav.append(link("Manage admins", href("admins"), route === "admins" ? "active" : ""));
  aside.append(nav, e("p", "aside-bottom", "A good menu starts here.\nChefDuo \xB7 Product management"));
  const workspace = e("div", "workspace"), top = e("header", "topbar");
  top.append(e("span", "eyebrow", "Your kitchen. Your menu."), e("span", "pill", preview ? "Design preview" : user?.adminRole === "owner" ? "Owner / Super Admin" : "Admin"));
  const main = e("main");
  main.id = "content";
  workspace.append(top);
  if (preview) workspace.append(previewNotice());
  workspace.append(main);
  shell2.append(aside, workspace);
  app.append(shell2);
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
  const list = e("div", "activity");
  if (!logs.length) list.append(e("div", "empty", preview ? "Real administrator activity will appear after secure setup." : "No menu changes recorded yet."));
  for (const row of logs) {
    const a = e("article");
    a.append(e("strong", "", `${row.action} \xB7 ${(row.after_value || row.before_value)?.name || row.entity_type}`), e("p", "muted", `${row.actor_email || "Database migration"} \xB7 ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(row.occurred_at))}`));
    const detail = e("details"), summary = e("summary", "", "View changes");
    detail.append(summary, e("pre", "audit-values", JSON.stringify({ before: row.before_value, after: row.after_value }, null, 2)));
    a.append(detail);
    list.append(a);
  }
  return list;
}
async function draftActivity(){
  return (await drafts.events()).map(row=>({...row,actor_email:row.actor_id===user.id?user.email:'Staff '+row.actor_id}));
}
async function dashboard(main) {
  heading(main, "Your menu, at a glance.", "Keep every dish up to date, from wherever you are.", link("+ Add product", href("products/new"), "button primary"));
  const metrics = e("div", "metrics");
  for (const [label, value] of [["Total products", catalog.products.length], ["Published products", catalog.products.filter((p) => p.status === "published").length], ["Hidden / archived", catalog.products.filter((p) => p.status !== "published").length], ["Categories", catalog.categories.length]]) {
    const n = e("section", "metric");
    n.append(e("span", "", label), e("strong", "", String(value)));
    metrics.append(n);
  }
  main.append(metrics);
  if(drafts){
    const panel=e("section","panel");
    panel.append(e("h2","","Review and publish"),e("p","muted",`Draft version ${drafts.version} · Live revision ${drafts.sequence}. Review all products, prices and images before publishing.`));
    panel.append(button("Preview publication",()=>{
      const {d,f}=modal("Publish a complete catalog revision?");
      f.append(e("p","",`${catalog.products.filter(p=>p.status==='published'&&p.available!==false&&catalog.categories.some(c=>c.id===p.category_id&&c.status==='published')).length} available products. Hidden, archived and unavailable products will be omitted. Older snapshots remain intact.`));
      const review=e("div","activity");
      for(const p of catalog.products)review.append(e("p","",`${p.name} · ${p.status} · ${p.available===false?'Unavailable':p.price_cents===null?p.variants.map(v=>v.name+': '+money(v.price_cents)).join(', '):money(p.price_cents)}`));
      f.append(review,button("Cancel",()=>d.close()),button("Publish revision",async()=>{guardWrite();await drafts.publish();await refresh();d.close();await render();toast("Complete revision published.");},"primary"));
    },"primary"));
    panel.append(button("Draft recovery history",async()=>{const events=await drafts.events();const {d,f}=modal("Recover a previous draft");for(const event of events.filter(x=>x.action==='DRAFT_SAVE'))f.append(button(`Restore draft before version ${event.version}`,async()=>{await drafts.restore(event.id);await refresh();d.close();await render();toast("Draft restored. Publish separately after review.");}));f.append(button("Close",()=>d.close()));}));
    main.append(panel);
  }else main.append(e("p","notice","Catalog editing and publishing are disabled. The customer menu remains frozen."));
  const grid = e("div", "two"), activity = e("section", "panel"), quick = e("section", "panel");
  activity.append(e("h2", "", "Recent menu activity"), recent(preview ? [] : drafts ? (await draftActivity()).slice(0,5) : result(await client.from("menu_audit_logs").select("*").order("occurred_at", { ascending: false }).limit(5))));
  quick.append(e("div", "eyebrow", "Make something delicious"), e("h2", "", "A little update goes a long way."), e("p", "muted", "Refresh a price, add a new favorite or give your menu a new photograph."), link("Manage products", href("products"), "button primary"), e("p", "subtle", preview ? "Counts come from the current public-menu snapshot." : "Draft changes require review and atomic publication. Live editing remains gated until activation."), link("View public website \u2197", "https://chefduo.vercel.app/"));
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
    const x = field(v.name + " (PHP)", "number", (v.price_cents / 100).toFixed(2), true);
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
  heading(main, "Products", "A place for every ChefDuo favorite.", link("+ Add product", href("products/new"), "button primary"));
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
      actions.append(link("Edit", href("products/new") + (preview ? "&" : "?") + "id=" + encodeURIComponent(item.id || item.legacy_key)), button("Price", () => quickPrice(item)));
      if (!preview) {
        actions.append(button(item.status === "published" ? "Hide" : "Publish", async () => {
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
  if (id && !item) throw new Error("Product not found.");
  heading(main, item ? "Edit product" : "Add a new favorite", "Changes are saved only after you choose Save.", link("\u2190 Products", href("products")));
  const form = e("form", "panel form-grid product-editor");
  const dirtyNote = e("p", "editor-state wide", "All changes are saved together.");
  dirtyNote.setAttribute("role", "status");
  let dirty = false;
  const leaveWarning = (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", leaveWarning);
  const markDirty = () => {
    dirty = true;
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
  const order=field("Display order","number",item?.sort_order ?? 0,true);
  order.input.step="1";
  const availability=selectField("Availability",[["yes","Available"],["no","Unavailable — omit from customer menu"]],item?.available===false?"no":"yes");
  const state = selectField("Visibility", [["hidden", "Hidden \u2014 draft"], ["published", "Published"], ["archived", "Archived"]], item?.status || "hidden");
  const mode = selectField("Pricing", [["base", "One price"], ["variants", "Multiple sizes / variants"]], item?.variants?.length ? "variants" : "base");
  const price = field("Price (PHP)", "number", item?.price_cents !== null && item?.price_cents !== void 0 ? (item.price_cents / 100).toFixed(2) : "");
  price.input.min = "0";
  price.input.step = ".01";
  price.input.inputMode = "decimal";
  price.input.max = "1000000";
  const variants = e("div", "wide field-group");
  const variantInputs = [];
  function addVariant(v = { name: "", price_cents: 0 }) {
    const row = e("div", "inline-fields");
    const n = field("Size / variant", "text", v.name, true), p = field("Price (PHP)", "number", (v.price_cents / 100).toFixed(2), true);
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
    addVariant();
    markDirty();
  });
  variants.append(add);
  const flavors = field("Flavors & sauces \u2014 one per line", "textarea", (item?.flavors || []).join("\n"));
  flavors.label.classList.add("wide");
  const image = field("Upload photograph \u2014 JPG, PNG or WebP, up to 5 MB", "file");
  image.input.accept = "image/jpeg,image/png,image/webp";
  image.label.classList.add("wide");
  const previewImg = e("img", "image-preview");
  previewImg.alt = "Product photograph preview";
  previewImg.hidden = !item;
  if (item) {
    if (preview) previewImg.src = new URL(item.image_url, root);
    else bindImage(previewImg, client, item);
  }
  let blob;
  image.input.onchange = () => {
    if (blob) URL.revokeObjectURL(blob);
    if (image.input.files[0]) {
      previewImg.dispatchEvent(new Event("local-photo-selected"));
      blob = URL.createObjectURL(image.input.files[0]);
      previewImg.src = blob;
      previewImg.hidden = false;
    }
  };
  form.append(name.label, category.label, description.label, order.label, availability.label, state.label, mode.label, price.label, variants, flavors.label, image.label, previewImg);
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
  mode.input.onchange = pricing;
  pricing();
  const actions = e("div", "actions wide editor-actions");
  const submit = e("button", "primary", preview ? "Saving unavailable in preview" : "Save product");
  submit.type = "submit";
  submit.disabled = preview || !drafts || !catalog.categories.length;
  actions.append(submit, link("Cancel", href("products")));
  if (item && !preview) {
    actions.append(button("Archive", async () => {
      await save("menu_products", { status: "archived" }, item.id, item.updated_at);
      location.href = href("products");
    }), button("Delete", () => {
      if (item.status !== "archived") throw new Error("Archive this product before deleting it.");
      return remove("menu_products", item);
    }, "danger"));
  }
  form.append(dirtyNote, actions);
  main.append(form);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    guardWrite();
    submit.disabled = true;
    let uploaded;
    try {
      const payload = { sort_order:Number(order.input.value), available:availability.input.value==="yes", name: name.input.value.trim(), category_id: category.input.value, description: description.input.value.trim(), status: state.input.value, price_cents: mode.input.value === "base" ? parseCentavos(price.input.value) : null, variants: mode.input.value === "variants" ? variantInputs.map((x) => ({ name: x.n.input.value.trim(), price_cents: parseCentavos(x.p.input.value) })) : [], flavors: flavors.input.value.split("\n").map((v) => v.trim()).filter(Boolean) };
      if (mode.input.value === "variants" && !payload.variants.length) throw new Error("Add at least one price variant.");
      if (image.input.files[0]) {
        uploaded = await drafts.upload(image.input.files[0]);
        payload.image_path = null;
        payload.image_url = uploaded;
      }
      await save("menu_products", payload, item?.id, item?.updated_at);
      dirty = false;
      window.removeEventListener("beforeunload", leaveWarning);
      location.href = href("products");
    } catch (err) {
      // A verified orphan upload is retained for later authorized, reference-aware GC.
      fail(err);
    } finally {
      submit.disabled = false;
    }
  };
}
async function categoryForm(item) {
  const { d, f } = modal(item ? "Edit category" : "New category");
  const name = field("Category name", "text", item?.name || "", true), slug = field("Permanent link identifier", "text", item?.slug || "", true), description = field("Description", "textarea", item?.description || ""), order = field("Display order", "number", item?.sort_order || 0, true), state = selectField("Visibility", [["published", "Published"], ["hidden", "Hidden"], ["archived", "Archived"]], item?.status || "hidden"), image = field("Category photograph (max 5 MB)", "file");
  slug.input.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
  slug.input.readOnly = !!item;
  image.input.accept = "image/jpeg,image/png,image/webp";
  f.append(name.label, slug.label, e("small", "help", "The link identifier stays fixed so existing category links keep working."), description.label, order.label, state.label, image.label);
  const actions = e("div", "actions");
  const submit = e("button", "primary", "Save category");
  submit.type = "submit";
  submit.disabled = preview || !drafts;
  actions.append(submit, button("Cancel", () => d.close()));
  if (item && !preview) actions.append(button("Delete", () => {
    if (catalog.products.some((p) => p.category_id === item.id)) throw new Error("Move or delete dependent products before deleting this category.");
    d.close();
    return remove("menu_categories", item);
  }, "danger"));
  f.append(actions);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    submit.disabled = true;
    let uploaded;
    try {
      guardWrite();
      const payload = { name: name.input.value.trim(), description: description.input.value.trim(), sort_order: Number(order.input.value), status: state.input.value };
      if (!item) payload.slug = slug.input.value;
      if (image.input.files[0]) {
        uploaded = await drafts.upload(image.input.files[0]);
        payload.image_path = null;
        payload.image_url = uploaded;
      }
      await save("menu_categories", payload, item?.id, item?.updated_at);
      // Immutable images and previous revisions are retained; never delete on replacement.
      d.close();
      render();
    } catch (err) {
      // A verified orphan upload is retained for later authorized, reference-aware GC.
      fail(err);
    } finally {
      submit.disabled = false;
    }
  };
}
async function categories(main) {
  heading(main, "Categories", "Organize your menu. Keep familiar links working.", button("+ Add category", () => categoryForm(), "primary"));
  const grid = e("div", "category-grid");
  for (const item of catalog.categories) {
    const card = e("article", "category-card"), img = e("img");
    if (preview) img.src = new URL(item.image_url, root);
    else bindImage(img, client, item);
    img.alt = item.name;
    const body = e("div", "body");
    body.append(e("h2", "", item.name), status(item.status), e("p", "subtle", `${catalog.products.filter((p) => (p.category_id || p.category_slug) === (item.id || item.slug)).length} products \xB7 Order ${item.sort_order}`), button("Edit category", () => categoryForm(item)));
    card.append(img, body);
    grid.append(card);
  }
  if (!catalog.categories.length) grid.append(e("div", "empty", "No categories yet. Add a category before adding products."));
  main.append(grid);
}
async function audit(main) {
  heading(main, "Activity log", "A read-only history of successful menu changes. Times shown in Asia/Manila.");
  if(drafts){main.append(recent(await draftActivity()),e('p','subtle','Latest 100 draft/publication events shown. Full before/after payloads are retained server-side for authorized review and recovery.'));return;}
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
async function render() {
  const main = shell();
  try {
    if (!route) await dashboard(main);
    else if (route === "products") await products(main);
    else if (route === "products/new") await editProduct(main);
    else if (route === "categories") await categories(main);
    else if (route === "audit-logs") await audit(main);
    else if (route === "settings") await settings(main);
    else if (route === "admins") await manageAdmins(main);
    else main.append(e("h1", "", "Page not found"), link("Return to overview", href("")));
  } catch (err) {
    main.append(e("p", "error", err.message));
  }
}
async function start() {
  try {
    client = await connection();
    if(client && (await readConfig(false)).catalogEditing === "atomic-v1") drafts=new CatalogDrafts(client);
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
    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") location.replace(new URL("login/", adminURL));
    });
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden) {
        try {
          const current = await authorize(client);
          if (!current) {
            await client.auth.signOut();
            location.replace(new URL("login/", adminURL));
          } else user = current;
        } catch {
          toast("Access could not be checked. Protected changes still require server authorization.");
        }
      }
    });
    if(!["settings","admins"].includes(route))await refresh();
    await render();
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
      await perform();
      d.close();
      await render();
      toast("Account access updated.");
    } catch (error) {
      fail(error);
    } finally {
      submit.disabled = false;
    }
  };
}
async function manageAdmins(main) {
  if (!preview && user?.adminRole !== "owner") throw new Error("Only an active Owner can manage administrators.");
  heading(main, "Manage admins", "Each administrator uses their own email and password.", button("+ Invite admin", inviteAdmin, "primary"));
  if (preview) {
    main.append(e("div", "empty", "Owner-only page preview. No account information or sample identities are shown. Sign-in and server authorization are required for management."));
    return;
  }
  const data = await accountOperation(client, { action: "list" }), list = e("div", "account-list");
  const ownerCount = data.members.filter((m) => m.role === "owner" && m.status === "active").length;
  for (const item of [...data.members, ...data.invitations.map((i) => ({ ...i, role: "admin", invitation_status: i.status, status: i.status, added_at: i.created_at, invitation_id: i.id }))]) {
    const card = e("article", "panel account-card");
    card.append(e("h2", "long", item.email), e("p", "", item.role === "owner" ? "Owner / Super Admin" : "Admin"), status(item.status), e("p", "subtle", "Invitation: " + ({ sent: "Email requested", provisioning: "Preparing", failed: "Request failed", accepted: "Accepted", revoked: "Revoked" }[item.invitation_status] || "Not invited")), e("p", "subtle", "Added: " + new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(item.added_at))));
    const actions = e("div", "actions");
    const act = (label, action, extra = {}) => button(label, () => confirmAction(label, "Confirm this change for " + item.email + ". Access changes apply to subsequent protected operations.", () => accountOperation(client, { action, target: item.user_id, ...extra })));
    if (["invited", "failed", "sent", "provisioning"].includes(item.status)) actions.append(button("Resend invitation", () => confirmAction("Resend invitation", "A new email will be requested. Wait at least 60 seconds between requests.", () => accountOperation(client, { action: "resend", email: item.email }))));
    if (item.role === "owner" && item.status === "active" && ownerCount === 1) card.append(e("p", "help", "The final active Owner is protected. Authorize a second Owner before changing this account."));
    if (item.status === "active" && !(item.role === "owner" && ownerCount === 1)) actions.append(act("Disable admin", "disable"), act(item.role === "owner" ? "Make Admin" : "Make Owner", "role", { role: item.role === "owner" ? "admin" : "owner" }));
    if (item.status === "disabled") actions.append(act("Restore access", "restore"));
    if (!item.user_id && ["failed", "sent", "provisioning"].includes(item.status)) actions.append(button("Cancel invitation", () => confirmAction("Cancel invitation", "Any email already queued cannot be recalled; account access will remain blocked.", () => accountOperation(client, { action: "cancel_invite", invitation: item.invitation_id }))));
    if (item.user_id && item.status !== "revoked" && !(item.role === "owner" && item.status === "active" && ownerCount === 1)) actions.append(act("Revoke access", "revoke"));
    card.append(actions);
    list.append(card);
  }
  if (!data.members.length && !data.invitations.length) list.append(e("div", "empty", "No administrator records. Initial Owner provisioning must use trusted Supabase administration."));
  main.append(list);
  const activity = e("section", "panel");
  activity.append(e("h2", "", "Administrator activity"));
  const rows = result(await client.from("admin_audit_logs").select("*").order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(50));
  if (!rows.length) activity.append(e("p", "muted", "No administrator-management activity yet."));
  for (const row of rows) {
    const item = e("article", "activity-entry");
    item.append(e("strong", "", row.action + " \xB7 " + row.entity_type), e("p", "subtle", new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(row.occurred_at)) + " \xB7 " + (data.members.find((member) => member.user_id === row.actor_id)?.email || row.actor_id || "Trusted provisioning")));
    const details = e("details");
    details.append(e("summary", "", "View changes"), e("pre", "audit-values", JSON.stringify({ before: row.before_value, after: row.after_value }, null, 2)));
    item.append(details);
    activity.append(item);
  }
  main.append(activity);
}
function inviteAdmin() {
  guardSession();
  if (user?.adminRole !== "owner") throw new Error("Owner access required.");
  const { d, f } = modal("Invite administrator");
  const email = field("Administrator email", "email", "", true);
  email.input.autocomplete = "off";
  email.input.maxLength = 254;
  f.append(email.label, e("p", "help", "The recipient verifies their email and chooses their own password. New invitations grant the Admin role only."));
  const actions = e("div", "actions");
  const submit = e("button", "primary", "Send invitation");
  submit.type = "submit";
  actions.append(submit, button("Cancel", () => d.close()));
  f.append(actions);
  f.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await accountOperation(client, { action: "invite", email: email.input.value.trim() });
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
