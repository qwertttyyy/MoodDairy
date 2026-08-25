import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const publicDir = resolve('public')
const outputDir = resolve(publicDir, 'icons')
const logo = await readFile(resolve(publicDir, 'favicon.svg'), 'utf8')

await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

async function renderIcon(filename, size, maskable = false) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`
    <!doctype html>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        display: grid;
        place-items: center;
        background: ${maskable ? '#0b0c0a' : 'transparent'};
      }
      svg { display: block; width: ${maskable ? '80%' : '100%'}; height: ${maskable ? '80%' : '100%'}; }
    </style>
    ${logo}
  `)
  await page.screenshot({
    path: resolve(outputDir, filename),
    omitBackground: !maskable,
  })
}

await renderIcon('icon-192.png', 192)
await renderIcon('icon-512.png', 512)
await renderIcon('icon-maskable-192.png', 192, true)
await renderIcon('icon-maskable-512.png', 512, true)
await renderIcon('apple-touch-icon.png', 180)

await browser.close()
process.stdout.write('PWA icons generated from public/favicon.svg.\n')
