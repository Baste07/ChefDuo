import { imageURL, safeImage } from "./data.js";
const tracked = /* @__PURE__ */ new Map();
const renewAfter = 4e4;
let observer, timer;
function visible(img) {
  const r = (img.hidden ? img.parentElement : img)?.getBoundingClientRect();
  if (!r || !r.width || !r.height) return false;
  return r.bottom >= -200 && r.top <= window.innerHeight + 200 && r.right >= 0 && r.left <= window.innerWidth;
}
async function renew(entry, force = false) {
  if (!entry || !tracked.has(entry.img) || entry.failed || entry.busy || !entry.img.isConnected || document.hidden || !visible(entry.img)) return;
  if (!force && Date.now() - entry.signedAt < renewAfter) return;
  entry.busy = true;
  try {
    const url = await imageURL(entry.client, entry.row);
    if (!url) {
      showFailure(entry);
      return;
    }
    if (tracked.get(entry.img) !== entry) return;
    entry.signedAt = Date.now();
    entry.img.src = url;
  } catch {
    showFailure(entry);
  } finally {
    entry.busy = false;
  }
}
function sweep() {
  for (const [img, entry] of tracked) {
    if (!img.isConnected) {
      observer?.unobserve(img);
      tracked.delete(img);
      continue;
    }
    renew(entry).catch(() => {
    });
  }
  if (!tracked.size && timer) {
    clearInterval(timer);
    timer = void 0;
  }
}
function bindImage(img, client, row) {
  if (!row.image_path) {
    const src = safeImage(row.image_url);
    if (src) img.src = src;
    return;
  }
  const entry = { img, client, row, signedAt: -Infinity, busy: false, retry: false, recoveries: 0 };
  tracked.set(img, entry);
  img.addEventListener("local-photo-selected", () => {
    tracked.delete(img);
    observer?.unobserve(img);
  });
  if (!observer) observer = new IntersectionObserver((entries) => {
    for (const item of entries) if (item.isIntersecting) renew(tracked.get(item.target)).catch(() => {
    });
  }, { rootMargin: "200px" });
  observer.observe(img);
  img.addEventListener("load", () => {
    img.hidden = false;img.alt=entry.row.name||"Menu image";
    entry.retry = false;
    entry.recoveries = 0;
    entry.retryButton?.remove();
    entry.retryButton = null;
    const fallback = img.nextElementSibling;
    if (fallback?.className.includes("fallback")) fallback.style.display = "none";
  });
  img.addEventListener("error", () => {
    if (!entry.retry) {
      entry.retry = true;
      entry.failed = false;
      renew(entry, true).catch(() => {
      });
    } else showFailure(entry);
  });
  if (!timer) timer = setInterval(sweep, 1e4);
  queueMicrotask(() => renew(entry).catch(() => {
  }));
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    recoverVisible();
    sweep();
  }
});
function showFailure(entry) {
  entry.failed = true;
  entry.failedAt = Date.now();
  entry.img.alt = (entry.row.name || "Menu image") + " \u2014 unavailable";
  if (entry.retryButton || !entry.img.isConnected) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "image-retry";
  button.textContent = "Retry image";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    entry.failed = false;
    entry.retry = false;
    entry.recoveries = 0;
    renew(entry, true).catch(() => {
    });
  });
  const media=entry.img.parentElement;
  const actions=entry.img.closest('.product')?.querySelector('.row-actions');
  if(actions)actions.append(button);
  else {
    let container=media;
    if(media?.tagName==='A'){
      if(media.parentElement.dataset.imageRetryWrapper)container=media.parentElement;
      else{container=document.createElement('div');container.dataset.imageRetryWrapper='true';media.replaceWith(container);container.append(media);}
      container.append(button);
    }else entry.img.insertAdjacentElement('afterend',button);
    if(media?.matches('.product-media,.category-card')){container.style.position='relative';Object.assign(button.style,{position:'absolute',left:'12px',top:'12px',zIndex:'4',minHeight:'44px',background:'white',padding:'10px',borderRadius:'8px',border:'1px solid #aaa'});}
  }
  entry.retryButton=button;
}
function recoverVisible() {
  for (const entry of tracked.values()) if (entry.failed && visible(entry.img) && Date.now() - entry.failedAt >= 5e3 && entry.recoveries < 2) {
    entry.recoveries++;
    entry.failed = false;
    renew(entry, true).catch(() => {
    });
  }
}
if (typeof window !== "undefined") window.addEventListener("online", recoverVisible);
export {
  bindImage
};
