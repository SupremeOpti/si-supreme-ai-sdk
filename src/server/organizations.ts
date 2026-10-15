import { isVerifiedPrincipal } from './auth';
import { InvalidArgumentError, OrgAccessDeniedError } from './errors';
import type { MembershipApi } from './membership';
import type { IntrospectionPrincipal, MembershipOrganization, ResolvedOrganization } from './types';

export interface OrganizationsApi {
  /**
   * Resolve an `organization` tool argument (slug, or numeric id as a string
   * or number). With a user id it checks the user's live SI membership; with
   * a principal from `si.auth.introspect` it uses the principal's
   * `organizations` (no second SI call). Unknown and not-allowed orgs both
   * throw `OrgAccessDeniedError`, so a caller can't probe which orgs exist.
   */
  resolve(user: number | string | IntrospectionPrincipal, organization: string | number): Promise<ResolvedOrganization>;
}

/** Matcher for an `organization` argument: numeric id, or slug (case-insensitive). */
export function organizationMatcher(organization: string | number): { raw: string; match: (o: Pick<MembershipOrganization, 'id' | 'slug'>) => boolean } {
  const raw = typeof organization === 'number' ? String(organization) : typeof organization === 'string' ? organization.trim() : '';
  if (!raw || raw.length > 200) throw new InvalidArgumentError('organization must be an org slug or numeric id');
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    return { raw, match: (o) => o.id === id };
  }
  const slug = raw.toLowerCase();
  return { raw, match: (o) => o.slug.toLowerCase() === slug };
}

export function createOrganizations(membership: MembershipApi): OrganizationsApi {
  return {
    async resolve(user, organization) {
      const { raw, match } = organizationMatcher(organization);
      if (typeof user === 'object' && user !== null) {
        if (!isVerifiedPrincipal(user)) throw new InvalidArgumentError('principal must be the object returned by si.auth.introspect');
        const org = user.organizations.find(match);
        if (!org) throw new OrgAccessDeniedError(raw);
        return { ...org, roles: [...org.roles] };
      }
      const { organization: org } = await membership.findOrganization(user, match);
      if (!org) throw new OrgAccessDeniedError(raw);
      return org;
    },
  };
}
