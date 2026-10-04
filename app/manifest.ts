import type { MetadataRoute } from "next";

/** The web app manifest (M12): lets the library be installed like an app on a phone or computer. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Neolibrary",
    short_name: "Neolibrary",
    description: "A private library for independent study.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3ede1",
    theme_color: "#f3ede1",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
