import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "QoreChain SDK",
  tagline: "Build dApps on QoreChain — a quantum-safe, triple-VM Layer 1",
  favicon: "img/favicon.ico",

  url: "https://qorechain.github.io",
  baseUrl: "/",

  organizationName: "qorechain",
  projectName: "qorechain-sdk",

  onBrokenLinks: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/qorechain/qorechain-sdk/tree/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "QoreChain SDK",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/qorechain/qorechain-sdk",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Overview", to: "/" },
            { label: "Install", to: "/install" },
            { label: "Quickstart", to: "/quickstart" },
          ],
        },
        {
          title: "Reference",
          items: [
            { label: "Network & endpoints", to: "/reference/network" },
            { label: "CLI", to: "/reference/cli" },
            { label: "API reference", to: "/reference/api" },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/qorechain/qorechain-sdk",
            },
            { label: "FAQ", to: "/faq" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} QoreChain. Licensed under Apache-2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "toml", "rust", "go", "python", "solidity"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
