import { openapi } from "@/lib/openapi";
import { createAPIPage } from "fumadocs-openapi/ui";

export const FumadocsOperation = createAPIPage(openapi, {
  playground: {
    enabled: false,
  },
  showResponseSchema: true,
});
