import { DEFAULT_BRAND } from "../../packages/core/src/brand"

/** Every brand-shaped string on the site comes from here (hard rule 3). */
export const brand = DEFAULT_BRAND
export const docsRoute = "/docs"
// GitLab while the GitHub account is suspended; GitLab paths take a `/-/` segment (`/-/blob/…`).
export const repoUrl = `https://gitlab.com/moeen-mahmud/${brand.slug}`
export const dockerImage = `docker.io/moeenmahmud007/${brand.slug}`
/** The preprint that measures the settings floor. A preprint, not peer-reviewed: say so wherever it is cited. */
export const paperUrl = "https://arxiv.org/abs/2610.06274"

export const parentCompany = {
    name: "Blivius",
    url: "https://blivius.com",
    letterUrl: "https://blivius.com/letter",
    researchUrl: "https://blivius.com/research",
    email: "hello@blivius.com",
    designPartnerHref: `mailto:hello@blivius.com?subject=${encodeURIComponent(`${brand.name}: Design Partner`)}`,
} as const
