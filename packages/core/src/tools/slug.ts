/**
 * A tool slug as the registry compares it: case and separators ignored, so `GMAIL_FETCH_EMAILS`,
 * `gmail_fetch_emails` and `gmail-fetch-emails` are one tool.
 *
 * One function for every place that asks "is this the same tool?" — the registry's lookups, a phase's
 * allow list, and the tool groups. Two comparisons that disagree is how a group spelled differently from
 * its resolved tool withheld nothing, with no warning, while the registry resolved it fine.
 */
export function normaliseSlug(slug: string): string {
    return slug.toLowerCase().replace(/[\s_.-]+/g, "")
}
