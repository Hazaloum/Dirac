import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Curie",
    short_name: "Curie",
    description: "Visit logging for COMIX medical reps",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f5f3",
    theme_color: "#0c5c4c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
