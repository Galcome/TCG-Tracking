import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const output = new URL('../assets/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });

function icon(background) {
  return `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;width:1024px;height:1024px;background:${background};overflow:hidden}svg{display:block}</style>
  <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="face" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#18233d"/><stop offset="1" stop-color="#10182c"/></linearGradient>
      <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g transform="translate(512 512)" filter="url(#glow)">
      <rect x="-238" y="-292" width="356" height="474" rx="54" fill="#0a0e1a" stroke="#b47cff" stroke-width="22" transform="rotate(-16)"/>
      <rect x="-116" y="-260" width="356" height="474" rx="54" fill="#0a0e1a" stroke="#54e0aa" stroke-width="22" transform="rotate(14)"/>
      <rect x="-178" y="-270" width="356" height="474" rx="54" fill="url(#face)" stroke="#48c8f0" stroke-width="26"/>
      <path d="M-105 115h210" stroke="#48c8f0" stroke-width="18" stroke-linecap="round" opacity=".8"/>
    </g>
  </svg>`;
}

await page.setContent(icon('#0a0e1a'));
await page.screenshot({ path: fileURLToPath(new URL('icon.png', output)), type: 'png' });
await page.setContent(icon('transparent'));
await page.screenshot({ path: fileURLToPath(new URL('adaptive-icon.png', output)), type: 'png', omitBackground: true });
await browser.close();
