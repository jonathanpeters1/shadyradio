const { chromium } = require('playwright-core');

async function verifyAudio() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console logs
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`${msg.type()}: ${text}`);
    console.log(`[Browser] ${msg.type()}: ${text}`);
  });

  page.on('pageerror', err => {
    logs.push(`ERROR: ${err.message}`);
    console.log(`[Browser Error] ${err.message}`);
  });

  console.log('Navigating to test page...');
  await page.goto('http://localhost:3001/test.html');

  // Wait for page to load
  await page.waitForSelector('#start', { timeout: 5000 });
  console.log('Page loaded, clicking START...');

  // Click START
  await page.click('#start');

  // Wait for initialization
  console.log('Waiting for audio initialization...');
  await page.waitForTimeout(3000);

  // Check status
  const status = await page.$eval('#status', el => el.textContent);
  console.log(`Status: ${status}`);

  // Wait for potential audio to start
  console.log('Waiting 10 seconds for audio to load and play...');
  await page.waitForTimeout(10000);

  // Check for errors in logs
  const errors = logs.filter(l => l.includes('ERROR') || l.includes('error') || l.includes('Error'));
  if (errors.length > 0) {
    console.log('\nErrors found:');
    errors.forEach(e => console.log('  ' + e));
  }

  // Take screenshot
  await page.screenshot({ path: '/Users/jp/shadyradio/audio_test.png' });
  console.log('Screenshot saved to audio_test.png');

  const finalStatus = await page.$eval('#status', el => el.textContent);
  console.log(`Final status: ${finalStatus}`);

  // Check if track info is showing (indicating audio is playing)
  const hasTrackInfo = finalStatus.includes('Track') && finalStatus.includes('Bar');
  const hasError = finalStatus.includes('ERROR') || finalStatus.includes('error');

  if (hasTrackInfo) {
    console.log('\n✓ SUCCESS: Music appears to be cycling through DSP');
  } else if (hasError) {
    console.log('\n✗ FAILED: Error occurred - see logs above');
  } else {
    console.log('\n? Status: ' + finalStatus);
  }

  // Wait a bit more to see if track advances
  console.log('Waiting another 15 seconds to check for track cycling...');
  await page.waitForTimeout(15000);

  const laterStatus = await page.$eval('#status', el => el.textContent);
  console.log(`Later status: ${laterStatus}`);

  await page.screenshot({ path: '/Users/jp/shadyradio/audio_test_later.png' });

  await browser.close();
  return hasTrackInfo && !hasError;
}

verifyAudio().then(success => {
  console.log(success ? '\nVerification PASSED' : '\nVerification FAILED');
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
