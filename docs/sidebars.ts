import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "overview",
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
        "guides/svm",
        "guides/cosmwasm",
        "guides/cross-vm",
        "guides/multilayer",
        "guides/rollups",
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
