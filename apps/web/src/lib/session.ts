import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: 'admin' | 'operator' | 'readonly';
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  isSuperadmin: boolean;
  totpEnabled: boolean;
  mfaPending: boolean;
  orgs: OrgSummary[];
}

export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api<SessionUser>('/auth/session');
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useInvalidateSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['session'] });
}

const ORG_KEY = 'fe2o3-current-org';

export function currentOrgId(user: SessionUser): string | null {
  const stored = localStorage.getItem(ORG_KEY);
  if (stored && user.orgs.some((o) => o.id === stored)) return stored;
  return user.orgs[0]?.id ?? null;
}

export function setCurrentOrgId(id: string) {
  localStorage.setItem(ORG_KEY, id);
}
