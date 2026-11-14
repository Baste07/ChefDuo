import { validateServiceConfig } from "./config-policy.js";
import { createClient } from "@supabase/supabase-js";
const root = new URL("../", import.meta.url);
let instance;
let allowPreview = false;
async function readConfig(publicOnly) {
  const response = await fetch(new URL(publicOnly ? "customer-config.json" : "admin/config.json", root), { cache: "no-store" });
  if (!response.ok) throw new Error("Menu configuration is unavailable.");
  return response.json();
}
async function connection(publicOnly = false, suppliedConfig) {
  const config = suppliedConfig ?? await readConfig(publicOnly);
  allowPreview = config.allowLocalPreview === true;
  if (!config.enabled) return null;
  config.url = validateServiceConfig(config, location.href);
  if (publicOnly) return createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return instance ||= createClient(config.url, config.publishableKey, { auth: { flowType: "pkce", storage: sessionStorage, storageKey: "chefduo-admin", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
}
function result(r) {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
const money = (cents) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(cents / 100);
function safeImage(value) {
  if (!value) return "";
  try {
    const u = new URL(value, root);
    return u.protocol === "https:" || u.origin === root.origin ? u.href : "";
  } catch {
    return "";
  }
}
async function imageURL(client, row) {
  if (row.image_path) {
    const r = await client.storage.from("menu-images").createSignedUrl(row.image_path, 60);
    return r.error ? "" : r.data.signedUrl;
  }
  return safeImage(row.image_url);
}
async function authorize(client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const allowed = result(await client.rpc("chefduo_is_admin"));
  if (!allowed) return null;
  const context = result(await client.rpc("chefduo_admin_context"));
  return context?.enabled && context.status === "active" ? { ...data.user, adminRole: context.role } : null;
}
async function upload(client, file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5242880) throw new Error("Use a JPG, PNG or WebP image smaller than 5 MB.");
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
  const path = `${crypto.randomUUID()}.${ext}`;
  result(await client.storage.from("menu-images").upload(path, file, { contentType: file.type, upsert: false }));
  return path;
}
async function loadCatalog(client) {
  return { categories: result(await client.from("menu_categories").select("*").order("sort_order")), products: result(await client.from("menu_products").select("*").order("sort_order")) };
}
async function accountOperation(client, body) {
  const { data, error } = await client.functions.invoke("admin-accounts", { body });
  if(error){
    let message="The account operation could not be completed. Check your access and try again.";
    try{const payload=await error.context?.clone().json();if(typeof payload?.error==='string'&&payload.error.length<=512)message=payload.error;}catch{}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export {
  accountOperation,
  allowPreview,
  authorize,
  connection,
  readConfig,
  imageURL,
  loadCatalog,
  money,
  result,
  root,
  safeImage,
  upload
};
