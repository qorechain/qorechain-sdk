import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "overview",
    "why-qorechain",
    "install",
    "quickstart",
    {
      type: "category",
      label: "Concepts",
      items: ["concepts/architecture", "concepts/accounts-pqc"],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/messages",
        "guides/wallets",
        "guides/events",
        "guides/gas-fees-errors",
        "guides/evm",
        "guides/ai-preflight",
        "guides/svm",
        "guides/cosmwasm",
        "guides/cross-vm",
        "guides/multilayer",
        "guides/rollups",
        "guides/quantum-safe",
        "guides/react",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: ["reference/network", "reference/cli", "reference/api"],
    },
    "faq",
  ],
};

export default sidebars;
