function validateServiceConfig(config, pageURL) {
  const url = new URL(config.url), page = new URL(pageURL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use a service origin without credentials or paths.");
  const hosted = url.origin === "https://mprtxauuwvhkicjpkhvw.supabase.co";
  const loopback = config.allowLocalServices === true && ["localhost", "127.0.0.1"].includes(page.hostname) && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "54321";
  if (!hosted && !loopback) throw new Error("Invalid service origin. Local services require explicit loopback development configuration.");
  const key = config.publishableKey;
  if (typeof key !== "string" || !key || key.startsWith("sb_secret_")) throw new Error("A public publishable/anon key is required.");
  if (!key.startsWith("sb_publishable_")) {
    try {
      if (JSON.parse(atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).role !== "anon") throw new Error();
    } catch {
      throw new Error("Only a publishable or legacy anon key is permitted.");
    }
  }
  return url.origin;
}
export {
  validateServiceConfig
};
