const fs = require('fs')
const { globSync } = require('glob')

const FILES = [
  ...globSync('src/app/api/**/route.ts'),
  ...globSync('src/app/api/**/route.ts'),
  'mini-services/chat-service/index.ts',
]

let total = 0

for (const file of FILES) {
  if (!fs.existsSync(file)) continue
  const orig = fs.readFileSync(file, 'utf8')
  let mod = orig

  if (file.includes('chat-service')) {
    mod = mod.replace(/socket\.on\((['"][^'"]+['"]),\s*\(([^)]*)\)\s*=>\s*\{/g, "socket.on($1, async ($2) => {")
    mod = mod.replace(/createServer\(\(req[^)]*\)\s*=>\s*\{/g, 'createServer(async (req, res) => {')
  }

  // Add await before db.method( calls (not db.raw, not already awaited)
  const lines = mod.split('\n')
  const out = lines.map(line => {
    if (line.includes('import ') || line.trim().startsWith('//') || line.trim().startsWith('*')) return line
    return line.replace(/(?<!await )(?<!\.)db\.(?!raw\b)(\w+)\(/g, 'await db.$1(')
  })
  mod = out.join('\n')

  if (mod !== orig) {
    fs.writeFileSync(file, mod)
    total++
    console.log(`[updated] ${file}`)
  }
}
console.log(`\nDone! ${total} files updated.`)
