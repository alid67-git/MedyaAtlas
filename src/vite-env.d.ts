/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __APP_EDITION__: 'v1' | 'v2'

interface ImportMetaEnv {
  readonly VITE_MEDIAATLAS_EDITION?: 'v1' | 'v2'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
