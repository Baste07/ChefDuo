export function visibleCatalog({ categories, products }) {
  const ordered = rows => [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const visible = ordered(categories.filter(row => row.status === "published"));
  const ids = new Set(visible.map(row => row.id));
  return { categories: visible, products: ordered(products.filter(row =>
    row.status === "published" && row.available !== false && ids.has(row.category_id))) };
}

export async function catalogDigest(catalog) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.keys(value).filter(key => key !== "updated_at").sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  const rows = items => [...items].sort((a, b) => a.id.localeCompare(b.id))
    .map(row => canonical({ ...row, status: "published" }));
  const data = JSON.stringify([rows(catalog.categories), rows(catalog.products)]);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyCatalogRevision(catalog, visible, revision) {
  if (!visible.products.length || visible.categories.length !== catalog.categories.length ||
      visible.products.length !== catalog.products.length ||
      new Set(visible.categories.map(row => row.id)).size !== visible.categories.length ||
      new Set(visible.categories.map(row => row.slug)).size !== visible.categories.length ||
      new Set(visible.products.map(row => row.id)).size !== visible.products.length ||
      new Set(visible.products.map(row => row.legacy_key)).size !== visible.products.length ||
      !/^[a-f0-9]{64}$/.test(revision ?? "") || await catalogDigest(visible) !== revision) {
    throw new Error("Catalog revision mismatch");
  }
  for (const row of [...visible.categories, ...visible.products]) {
    const image = new URL(row.image_url);
    if (image.origin !== "https://mprtxauuwvhkicjpkhvw.supabase.co" || image.username || image.password ||
        !(image.pathname.startsWith("/storage/v1/object/public/menu-images-public/") || /^\/storage\/v1\/object\/public\/menu-images-revisions\/assets\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(image.pathname)) || image.search || image.hash ||
        row.image_path || !row.name?.trim()) throw new Error("Invalid catalog display data");
  }
  for (const product of visible.products) {
    if (!Array.isArray(product.variants) || (product.price_cents === null) !== (product.variants.length > 0) ||
        !product.variants.every(variant => typeof variant.name === "string" && variant.name.trim())) {
      throw new Error("Invalid catalog pricing");
    }
    if (product.price_cents !== null) menuPrice(product.price_cents);
    for (const variant of product.variants) menuPrice(variant.price_cents);
  }
}

export function requireLaunchCatalog({ categories, products }) {
  const slugs = new Set(categories.map(row => row.slug));
  if (categories.length !== 8 || slugs.size !== 8 ||
      new Set(categories.map(row => row.id)).size !== 8 ||
      products.length !== 38 || new Set(products.map(row => row.id)).size !== 38 ||
      products.filter(row => row.variants?.length).length !== 5) {
    throw new Error("Incomplete launch catalog");
  }
  for (const row of [...categories, ...products]) {
    if (!row.name || !row.image_url && !row.image_path) throw new Error("Catalog display data missing");
  }
}

export function menuPrice(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid centavo amount");
  const whole = new Intl.NumberFormat("en-PH").format(Math.floor(cents / 100));
  const remainder = cents % 100;
  return "₱" + whole + (remainder ? "." + String(remainder).padStart(2, "0") : "");
}
