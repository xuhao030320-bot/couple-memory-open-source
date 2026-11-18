import type { Plugin } from 'vite'

export function patchPageFlip(source: string): string
export function patchReactPageFlip(source: string): string
export function pageFlipLifecycle(): Plugin
