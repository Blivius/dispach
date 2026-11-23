import { ImageResponse } from "next/og"

export const size = { width: 64, height: 64 }
export const contentType = "image/png"

/** The Sliced Monolith emblem on the dark theme's background. */
export default function Icon() {
    return new ImageResponse(
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: "100%",
                background: "#121212",
                borderRadius: 14,
            }}
        >
            <svg aria-hidden="true" width="46" height="46" viewBox="0 0 120 120" fill="none">
                <path d="M22 66 L60 104 H22 Z" fill="#f4f4f6" />
                <path
                    d="M22 16 H26 L95.71 85.71 A44 44 0 0 1 75.27 101.27 L22 48 Z"
                    fill="#9b9ba6"
                />
                <path d="M44 16 H60 A44 44 0 0 1 101.78 73.78 Z" fill="#d75fd7" />
            </svg>
        </div>,
        size,
    )
}
