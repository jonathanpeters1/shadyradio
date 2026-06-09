const { chromium } = require('playwright-core');

async function verifyLong() {
  console.log('Launching browser for extended test...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => {
    logs.push(`${msg.type()}: ${msg.text()}`);
    console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    logs.push(`ERROR: ${err.message}`);
    console.log(`[Browser Error] ${err.message}`);
  });

  await page.goto('http://localhost:3001/test.html');
  await page.waitForSelector('#start', { timeout: 5000 });

  console.log('Clicking START...');
  await page.click('#start');

  // Wait for audio to start
  await page.waitForTimeout(5000);

  // Monitor for 90 seconds (should see Track 1 → Track 2 transition)
  console.log('Monitoring for 90 seconds...');
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(10000);
    const status = await page.$eval('#status', el => el.textContent.trim());
    console.log(`[${(i+1)*10}s] ${status.replace(/\s+/g, ' ')}`);
  }

  const finalStatus = await page.$eval('#status', el => el.textContent);
  console.log(`\nFinal: ${finalStatus}`);

  // Check if we saw multiple tracks
  const sawTrack2 = logs.some(l => l.includes('Track 2'));
  const sawTrack3 = logs.some(l => l.includes('Track 3'));

  console.log(`\nSaw Track 2: ${sawTrack2}`);
  console.log(`Saw Track 3: ${sawTrack3}`);

  await page.screenshot({ path: '/Users/jp/shadyradio/audio_final.png' });
  await browser.close();

  if (sawTrack2) {
    console.log('\n✓ SUCCESS: Music is cycling through tracks');
    return true;
  } else {
    console.log('\n✗ FAILED: Stuck on Track 1');
    return false;
  }
}

verifyLong().then(success => process.exit(success ? 0 : 1));
