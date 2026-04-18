import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Babylog",
    short_name: "Babylog",
    description: "A quiet place to log feedings, diapers, and sleep.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fefaf3",
    theme_color: "#5e7c4e",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-icon.svg",
        sizes: "180x180",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
