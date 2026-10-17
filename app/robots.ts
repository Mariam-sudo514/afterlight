import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/login", "/api/"],
    },
    sitemap: `${getSiteOrigin()}/sitemap.xml`,
  };
}
