function createAccountHandler({ verifyUser, rpc, invite, setPassword, redirectTo, allowedOrigins }) {
  const allowed = /* @__PURE__ */ new Set(["list", "invite", "resend", "disable", "restore", "revoke", "role", "accept", "cancel_invite"]);
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = { "content-type": "application/json", "cache-control": "no-store", "vary": "Origin" };
    if (origin && allowedOrigins.includes(origin)) headers["access-control-allow-origin"] = origin;
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return reply(403, { error: "Origin is not allowed." });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization,apikey,content-type,x-client-info" } });
    if (request.method !== "POST") return reply(405, { error: "Use POST." });
    let actor, action, reservation;
    try {
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ")) return reply(401, { error: "Sign in again." });
      const user = await verifyUser(authorization.slice(7));
      if (!user?.id) return reply(401, { error: "Sign in again." });
      actor = user.id;
      if (Number(request.headers.get("content-length")) > 4096) return reply(413, { error: "Request too large." });
      const reader = request.body?.getReader();
      let size = 0;
      const chunks = [];
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) {
            await reader.cancel();
            return reply(413, { error: "Request too large." });
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder().decode(bytes);
      const body = JSON.parse(text);
      action = body.action;
      if (!allowed.has(action)) return reply(400, { error: "Unsupported action." });
      if (action === "invite" || action === "resend") {
        const requestedRole = body.role ?? "admin";
        if (!["admin", "owner"].includes(requestedRole)) return reply(400, { error: "Choose Admin or Owner explicitly." });
        reservation = await rpc("chefduo_account_operation", { p_actor: actor, p_action: "begin_invite", p_email: body.email, p_role: requestedRole });
        if (reservation?.requested_role !== requestedRole) throw new Error("Invitation role contract mismatch; no email sent");
        const created = await invite(reservation.email, redirectTo);
        if (!created?.id) throw new Error("Invitation provider did not confirm provisioning");
        await rpc("chefduo_account_operation", { p_actor: actor, p_action: "finish_invite", p_invitation: reservation.id, p_user: created.id, p_lease: reservation.lease });
        return reply(200, { sent: true, message: "Invitation requested. Delivery depends on email service." });
      }
      if(action==='accept'){
        if(user.invitationVerified!==true)throw new Error('A verified current email-invitation session is required');
        if(typeof body.password!=='string'||body.password.length<12||body.password.length>1024||!setPassword)throw new Error('A strong self-chosen password is required');
        const proof=await rpc('chefduo_account_operation',{p_actor:actor,p_action:'prepare_accept'});
        if(!['admin','owner'].includes(proof?.requested_role)||!proof?.lease)throw new Error('Verified invitation role contract required');
        await setPassword(authorization.slice(7),body.password);
        const accepted=await rpc('chefduo_account_operation',{p_actor:actor,p_action:'accept',p_lease:proof.lease});
        if(accepted?.accepted!==true||accepted?.role!==proof.requested_role||accepted?.status!=='active')throw new Error('Accepted membership role mismatch; reconcile before retry');
        return reply(200,accepted);
      }
      const data = await rpc("chefduo_account_operation", { p_actor: actor, p_action: action, p_target: body.target || null, p_role: body.role || null, p_invitation: body.invitation || null });
      return reply(200, ["disable", "revoke"].includes(action) ? { ...data, session_cleanup_required: true, message: "Membership access is blocked. Complete separately authorized private global sign-out and verify session cleanup; this response does not claim sessions were revoked." } : data);
    } catch (error) {
      if (reservation) {
        try {
          await rpc("chefduo_account_operation", { p_actor: actor, p_action: "fail_invite", p_invitation: reservation.id, p_lease: reservation.lease });
        } catch {
        }
      }
      if (actor && allowed.has(action)) {
        try {
          await rpc("chefduo_record_account_failure", { p_actor: actor, p_action: action });
        } catch {
        }
      }
      if(action==='accept')return reply(400,{error:'Password setup or activation was not completed. Try a different strong password or ask the Owner to check the invitation.'});
      return reply(400, { error: "The account operation was not completed. Confirm your Owner access, account status and resend interval. Existing accounts may require trusted identity review." });
    }
  };
}
export {
  createAccountHandler
};
