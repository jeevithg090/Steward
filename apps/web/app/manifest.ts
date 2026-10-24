import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tempo",
    short_name: "Tempo",
    description: "Your time, returned.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#115e59",
    icons: [],
  };
}
