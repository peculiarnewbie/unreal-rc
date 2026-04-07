import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

export default defineConfig({
  site: "https://unreal-rc.peculiarnewbie.com",
  integrations: [
    starlight({
      title: "unreal-rc",
      description:
        "Typed TypeScript client for Unreal Engine Remote Control over WebSocket or HTTP.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/peculiarnewbie/unreal-rc"
        }
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Getting Started", link: "/guides/getting-started/" }
          ]
        },
        {
          ...typeDocSidebarGroup,
          label: "API",
          collapsed: false
        }
      ],
      plugins: [
        starlightTypeDoc({
          entryPoints: ["../core/src/public/index.ts"],
          tsconfig: "../core/tsconfig.json",
          output: "api",
          sidebar: {
            label: "API",
            collapsed: false
          },
          typeDoc: {
            hideGenerator: true,
            readme: "none",
            sort: ["source-order"]
          }
        })
      ]
    })
  ]
});
