import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";
import { appName, consoleUrl, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.04]">
            <Image
              src="/logo-mark.svg"
              alt=""
              width={22}
              height={22}
              className="h-[22px] w-[22px]"
              priority
            />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-fd-foreground">
              Synapse
            </span>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-fd-muted-foreground">
              Documentation
            </span>
          </span>
        </span>
      ),
      url: "/",
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        type: "main",
        text: "API Reference",
        url: "/api-reference",
        active: "nested-url",
      },
      {
        type: "main",
        text: "SDKs",
        url: "/sdks",
        active: "nested-url",
      },
      {
        type: "button",
        text: "Developer Console",
        url: consoleUrl,
        external: true,
      },
    ],
  };
}
