import { InvalidArgumentError, OrgAccessDeniedError } from './errors';
import type { MembershipApi } from './membership';
import type { ResolvedOrganization } from './types';

export interface OrganizationsApi {
  /**
   * Resolve an `organization` tool argument (slug, or numeric id as a string
   * or number) against the user's live SI membership. Unknown and
   * not-allowed orgs both throw `OrgAccessDeniedError`, so a caller can't
   * probe which orgs exist.
   */
  resolve(userId: number | string, organization: string | number): Promise<ResolvedOrganization>;
}

export function createOrganizations(membership: MembershipApi): OrganizationsApi {
  return {
    async resolve(userId, organization) {
      const raw = typeof organization === 'number' ? String(organization) : typeof organization === 'string' ? organization.trim() : '';
      if (!raw || raw.length > 200) throw new InvalidArgumentError('organization must be an org slug or numeric id');

      const match = /^\d+$/.test(raw)
        ? (() => {
            const id = Number(raw);
            return (o: { id: number }) => o.id === id;
          })()
        : (() => {
            const slug = raw.toLowerCase();
            return (o: { slug: string }) => o.slug.toLowerCase() === slug;
          })();

      const { organization: org } = await membership.findOrganization(userId, match);
      if (!org) throw new OrgAccessDeniedError(raw);
      return org;
    },
  };
}
