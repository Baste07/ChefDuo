// This decodes context ONLY AFTER Supabase getUser(token) validated the bearer token.
// It is not an independent JWT verifier and must never be used before authentication.
export function verifiedInviteSession(user,token){
 try{
  const claims=JSON.parse(atob(token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));
  const invited=Date.parse(user.invited_at);if(!Number.isFinite(invited)||claims.sub!==user.id)return false;
  return Array.isArray(claims.amr)&&claims.amr.some(item=>item.method==='otp'&&Number.isFinite(item.timestamp)&&item.timestamp>=Math.floor(invited/1000));
 }catch{return false;}
}
