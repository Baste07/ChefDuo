// Parse session context ONLY AFTER Supabase getUser(token) has verified the token.
// This helper never verifies JWT signatures or grants membership privileges.
export function verifiedSessionId(user, token) {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
    if (!user?.id || user.is_anonymous || claims.sub !== user.id || typeof claims.session_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(claims.session_id)) return null;
    return claims.session_id;
  } catch { return null; }
}
