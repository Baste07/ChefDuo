import { verifiedSessionId } from "./session-proof.js";
import {verifiedInviteSession} from "./auth-proof.js";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createAccountHandler } from "./handler.js";
const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
const secret = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const redirectTo = Deno.env.get("ADMIN_INVITE_REDIRECT");
const allowedOrigins = (Deno.env.get("ADMIN_ALLOWED_ORIGINS") || "").split(",").map((v) => v.trim()).filter(Boolean);
if (!url || !publicKey || !secret || !redirectTo || !allowedOrigins.length) throw new Error("Account function configuration is incomplete");
const redirect = new URL(redirectTo);
if (redirect.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(redirect.hostname)) throw new Error("HTTPS invitation redirect required");
if (!redirect.pathname.endsWith("/admin/accept/") || redirect.search || redirect.hash) throw new Error("Use the fixed admin invitation-accept path");
if (!allowedOrigins.includes(redirect.origin)) throw new Error("Invitation redirect origin must be explicitly allowed");
if (!allowedOrigins.includes("https://chefduo-admin.pages.dev")) allowedOrigins.push("https://chefduo-admin.pages.dev");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const verifier = createClient(url, publicKey, options);
const trusted = createClient(url, secret, options);
Deno.serve(createAccountHandler({
  redirectTo,
  allowedOrigins,
  async verifyUser(token) {
    const { data, error } = await verifier.auth.getUser(token);
    if (error || !data.user) return null;
    const session = verifiedSessionId(data.user, token);
    if (!session) return null;
    const active = await trusted.rpc("chefduo_session_active", { p_actor: data.user.id, p_session: session });
    if (active.error || active.data !== true) return null;
    return {...data.user, invitationVerified:verifiedInviteSession(data.user,token)};
  },
  async rpc(name, args) {
    const { data, error } = await trusted.rpc(name, args);
    if (error) throw error;
    return data;
  },
  async setPassword(token,password){
    const response=await fetch(url+'/auth/v1/user',{method:'PUT',headers:{apikey:publicKey,Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({password})});
    const accepted=response.ok;await response.body?.cancel();if(!accepted)throw new Error('User-scoped password update rejected');
  },
  async invite(email, redirectTo2) {
    const { data, error } = await trusted.auth.admin.inviteUserByEmail(email, { redirectTo: redirectTo2 });
    if (error) throw error;
    return data.user;
  }
}));
