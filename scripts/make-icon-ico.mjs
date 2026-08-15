import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Embed PNG into a Vista+ .ico (used by Windows exe / shortcuts). */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pngPath = path.join(root, 'build', 'icon.png')
const icoPath = path.join(root, 'build', 'icon.ico')

const png = fs.readFileSync(pngPath)
const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // icon
header.writeUInt16LE(1, 4) // one image

const entry = Buffer.alloc(16)
entry[0] = width >= 256 ? 0 : width
entry[1] = height >= 256 ? 0 : height
entry.writeUInt16LE(0, 2)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12)

fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]))
console.log(`Wrote ${path.relative(root, icoPath)} (${width}x${height})`)
