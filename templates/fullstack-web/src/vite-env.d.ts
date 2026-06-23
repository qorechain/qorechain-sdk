/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QORE_REST_URL?: string;
  readonly VITE_QORE_EVM_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
