import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { type OrgSummary, useSession } from './session';

const ORG_KEY = 'fe2o3-current-org';

export type OrgRole = 'admin' | 'operator' | 'readonly';

interface OrgContextValue {
  /** The org every page's data is scoped to. */
  orgId: string | null;
  /** Orgs the user may switch between (all orgs for superadmins). */
  orgs: OrgSummary[];
  /** Caller's role in the selected org (admin for superadmins). */
  role: OrgRole | null;
  setOrgId: (id: string) => void;
}

const OrgContext = createContext<OrgContextValue>({
  orgId: null,
  orgs: [],
  role: null,
  setOrgId: () => {},
});

/**
 * Holds the selected org in React state (mirrored to localStorage) so every
 * page re-renders and re-queries when the nav switcher changes it. Superadmins
 * can switch to any org; other users to those they belong to.
 */
export function OrgProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const user = session.data;
  const isSuper = user?.isSuperadmin ?? false;

  // Superadmins can target any org, not just their memberships.
  const allOrgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api<{ id: string; name: string; slug: string }[]>('/orgs'),
    enabled: isSuper,
  });

  const orgs = useMemo<OrgSummary[]>(() => {
    if (isSuper) {
      return (allOrgs.data ?? []).map((o) => ({ ...o, role: 'admin' as const }));
    }
    return user?.orgs ?? [];
  }, [isSuper, allOrgs.data, user?.orgs]);

  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(ORG_KEY));

  // Keep the selection valid as the org list resolves / changes.
  useEffect(() => {
    if (orgs.length === 0) return;
    if (!selected || !orgs.some((o) => o.id === selected)) {
      setSelected(orgs[0]?.id ?? null);
    }
  }, [orgs, selected]);

  const setOrgId = useCallback((id: string) => {
    localStorage.setItem(ORG_KEY, id);
    setSelected(id);
  }, []);

  const orgId = selected && orgs.some((o) => o.id === selected) ? selected : (orgs[0]?.id ?? null);
  const role = orgs.find((o) => o.id === orgId)?.role ?? null;

  const value = useMemo<OrgContextValue>(
    () => ({ orgId, orgs, role, setOrgId }),
    [orgId, orgs, role, setOrgId],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}
