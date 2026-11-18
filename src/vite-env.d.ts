/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LAYOUT_PROVIDER?: 'rules' | 'remote'
  readonly VITE_LAYOUT_ENDPOINT?: string
  readonly VITE_DATA_PROVIDER?: 'local' | 'supabase' | 'cloudbase'
  readonly VITE_CLOUDBASE_ENV_ID?: string
  readonly VITE_CLOUDBASE_REGION?: string
  readonly VITE_CLOUDBASE_PUBLISHABLE_KEY?: string
  readonly VITE_CLOUDBASE_ACCESS_KEY?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
