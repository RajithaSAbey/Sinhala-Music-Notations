const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.argv[2]);
  await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await p.setViewportSize({ width: 794, height: 1123 });
  await p.screenshot({ path: process.argv[3].replace('.pdf', '.png'), fullPage: true });
  await b.close();
})();
