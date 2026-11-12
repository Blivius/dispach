import { DEFAULT_BRAND } from "../../packages/core/src/brand"

/** Every brand-shaped string on the site comes from here (hard rule 3). */
export const brand = DEFAULT_BRAND
export const docsRoute = "/docs"
// GitLab while the GitHub account is suspended; GitLab paths take a `/-/` segment (`/-/blob/…`).
export const repoUrl = `https://gitlab.com/moeen-mahmud/${brand.slug}`
