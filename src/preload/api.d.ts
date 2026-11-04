import type { LhApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    lh: LhApi
  }
}

export {}
