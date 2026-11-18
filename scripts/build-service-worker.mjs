import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function writeOfflineWorker(root, provider) {
  const dist = path.join(root, 'dist')
  const manifest = JSON.parse(await fs.readFile(path.join(dist, '.vite', 'manifest.json'), 'utf8'))
  const selected = new Set(['/', '/manifest.webmanifest', '/icon.svg'])
  const visited = new Set()
  const visit = (key) => {
    if (visited.has(key)) return
    visited.add(key)
    const entry = manifest[key]
    if (!entry) return
    selected.add('/' + entry.file)
    for (const file of [...(entry.css || []), ...(entry.assets || [])]) selected.add('/' + file)
    for (const dependency of entry.imports || []) visit(dependency)
  }
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.isEntry || /^src\/views\/.+View\.tsx$/.test(key) || key === 'src/components/HomeAlbum.tsx'
      || key === `src/lib/providers/${provider}.ts`
      || (provider === 'local' && ['src/lib/local-trash.ts', 'src/lib/workspace-backup.ts'].includes(key))) visit(key)
  }
  try {
    for (const filename of await fs.readdir(path.join(dist, 'moments'))) selected.add('/moments/' + filename)
  } catch { /* Optional sample photos may be omitted. */ }
  const assets = [...selected].sort()
  const template = await fs.readFile(path.join(root, 'public', 'sw.js'), 'utf8')
  const version = createHash('sha256').update(template + JSON.stringify(assets)).digest('hex').slice(0, 12)
  const source = template.replace(/^const CACHE_NAME = .+$/m, `const CACHE_NAME = ${JSON.stringify('only-us-shell-' + version)}`)
    .replace(/^const APP_SHELL = .+$/m, `const APP_SHELL = ${JSON.stringify(assets)}`)
  await fs.writeFile(path.join(dist, 'sw.js'), source)
  console.log(`Offline shell: ${assets.length} release resources (${provider})`)
}
