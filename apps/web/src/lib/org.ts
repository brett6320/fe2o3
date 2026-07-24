import { currentOrgId, useSession } from './session';

/** Current org id + role for the signed-in user (superadmin ⇒ admin everywhere). */
export function useOrg() {
  const session = useSession();
  const user = session.data;
  if (!user) return { orgId: null, role: null as 'admin' | 'operator' | 'readonly' | null };
  const orgId = currentOrgId(user);
  const membership = user.orgs.find((o) => o.id === orgId);
  const role = user.isSuperadmin ? 'admin' : (membership?.role ?? null);
  return { orgId, role };
}
