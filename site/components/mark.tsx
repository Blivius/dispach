/**
 * The Sliced Monolith mark (`.github/assets/mark.svg`) in the page's own colours: the ground and the
 * bridge follow the text, the lead wedge takes the accent. The favicon (`app/icon.tsx`) draws the same
 * three paths with fixed colours, because an image response has no theme to inherit.
 */
export function Mark({ className = "h-5 w-5" }: { readonly className?: string }) {
    return (
        <svg aria-hidden="true" viewBox="0 0 120 120" className={className} fill="none">
            <path d="M22 66 L60 104 H22 Z" fill="currentColor" />
            <path
                d="M22 16 H26 L95.71 85.71 A44 44 0 0 1 75.27 101.27 L22 48 Z"
                fill="currentColor"
                fillOpacity="0.52"
            />
            <path d="M44 16 H60 A44 44 0 0 1 101.78 73.78 Z" className="fill-term-accent" />
        </svg>
    )
}
