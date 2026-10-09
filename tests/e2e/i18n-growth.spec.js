import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const officialUrl = 'https://zwhy149.github.io/bead-grid-studio/';

async function waitForPattern(page) {
  await expect(page.locator('#convertOverlay')).not.toHaveClass(/is-visible/, { timeout: 20_000 });
  await expect(page.locator('#patternReadyBar')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => Number((await page.locator('#totalBeads').textContent())?.replace(/\D/g, '') || 0)).toBeGreaterThan(0);
}

test('interface stays Chinese and language switching is disabled', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bead-grid-studio:locale', 'en-US'));
  await page.goto('/?lang=en-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('#trySampleBtn')).toHaveText(/试试示例/);
  await expect(page.locator('.language-switcher')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('browser language does not override the locked Chinese interface', async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => {
    localStorage.removeItem('bead-grid-studio:locale');
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'en-US' });
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('#emptyUploadBtn')).toHaveText(/选择图片/);
});

test('Chinese onboarding generates the bundled sample without network image upload', async ({ page }) => {
  const shared = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => { window.__sharedPayload = payload; },
    });
  });
  page.on('request', (request) => {
    if (/rocket-badge/i.test(request.url())) shared.push(request.url());
  });
  await page.goto('/?lang=en-US');
  await expect(page.locator('#heroTitle')).toHaveText('图片 → 拼豆图纸');
  await page.locator('#trySampleBtn').click();
  await waitForPattern(page);
  expect(shared).toEqual([]);
  const renderedCopy = await page.locator('#projectSubtitle,#fileDetails,#legendStrip,#statusMessage,.toast').allTextContents();
  expect(renderedCopy.join(' ')).not.toMatch(/\{(?:width|height|suffix|message|background|merged)\}/);

  await page.locator('#readyShareBtn').click();
  await expect.poll(() => page.evaluate(() => window.__sharedPayload)).toMatchObject({
    url: `${officialUrl}?lang=zh-CN`,
  });
  const payload = await page.evaluate(() => window.__sharedPayload);
  expect(payload.title).toMatch(/豆格工坊/);
  expect(payload.text).toMatch(/拼豆图纸/);
});

test('Chinese key interface has no missing translation keys', async ({ page }) => {
  await page.goto('/');
  const exposedLabels = await page.locator('[aria-label],[title]').evaluateAll((nodes) => nodes.flatMap((node) => [
    node.getAttribute('aria-label'),
    node.getAttribute('title'),
  ]).filter(Boolean));
  expect(exposedLabels.filter((value) => /^[a-z][\w-]*\.[\w.-]+$/.test(value))).toEqual([]);
});

test('onboarding and core actions do not overflow at supported widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'explicit viewport matrix runs once in Chromium');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.goto('/?lang=en-US');
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      actions: [...document.querySelectorAll('#trySampleBtn,#emptyUploadBtn,#downloadOfflineLink,[data-locale]')]
        .filter((node) => node.getClientRects().length)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        }),
    }));
    expect(geometry.document, `${width}px document width`).toBeLessThanOrEqual(geometry.viewport);
    for (const action of geometry.actions) {
      expect(action.left, `${width}px action starts in viewport`).toBeGreaterThanOrEqual(0);
      expect(action.right, `${width}px action ends in viewport`).toBeLessThanOrEqual(geometry.viewport + 0.5);
      expect(action.height, `${width}px action touch height`).toBeGreaterThanOrEqual(44);
    }
  }
});

test('share-card exports have exact social dimensions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'download dimensions run once in Chromium');
  await page.goto('/?lang=en-US');
  await page.locator('#trySampleBtn').click();
  await waitForPattern(page);

  for (const [format, expectedWidth, expectedHeight] of [
    ['wide', 1200, 675],
    ['portrait', 1080, 1440],
  ]) {
    await page.locator('#readyShareCardBtn').click();
    await expect(page.locator('#shareDialog')).toBeVisible();
    await page.locator('#shareFormat').selectOption(format);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#shareCardDownloadBtn').click();
    const download = await downloadPromise;
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(expectedWidth);
    expect(bytes.readUInt32BE(20)).toBe(expectedHeight);
    if (await page.locator('#shareDialog').isVisible()) await page.locator('#shareCardCloseBtn').click();
  }
});

test('making assistant tracks one color, survives recovery, and exports materials CSV', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'making-state and download workflow runs once in Chromium');
  await page.goto('/?lang=en-US');
  await page.locator('#trySampleBtn').click();
  await waitForPattern(page);

  await expect(page.locator('.stat-percent').first()).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedMaterialList=text;}}}));
  await page.locator('#copyStatsBtn').click();
  await expect.poll(() => page.evaluate(() => window.__copiedMaterialList || '')).toMatch(/拼豆购豆清单[\s\S]+颗/);

  await page.locator('#readyMakeBtn').click();
  await expect(page.locator('#makingAssistant')).toBeVisible();
  await expect(page.locator('#makingProgressBar')).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#makingCompleteBtn').click();
  await expect.poll(async () => Number(await page.locator('#makingProgressBar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(page.locator('.stat-row.is-complete')).toHaveCount(1);

  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const box=node=>{const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,width:rect.width,height:rect.height};};
      const assistant=box(document.querySelector('#makingAssistant'));
      const stage=box(document.querySelector('.stage-panel'));
      const palette=box(document.querySelector('#palettePanel'));
      const controls=[...document.querySelectorAll('#makingAssistant button')].map(box);
      return {viewport:innerWidth,document:document.documentElement.scrollWidth,assistant,stage,palette,controls,paletteVisible:palette.width>100};
    });
    expect(geometry.document, `${width}px making document width`).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.assistant.left).toBeGreaterThanOrEqual(0);
    expect(geometry.assistant.right).toBeLessThanOrEqual(geometry.viewport+.5);
    if(width>=960&&geometry.paletteVisible)expect(geometry.stage.right).toBeLessThanOrEqual(geometry.palette.left+.5);
    for(const control of geometry.controls){
      expect(control.left).toBeGreaterThanOrEqual(geometry.assistant.left-.5);
      expect(control.right).toBeLessThanOrEqual(geometry.assistant.right+.5);
      expect(control.height).toBeGreaterThanOrEqual(width<960?44:30);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  await expect.poll(() => page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem('bead-grid-studio:draft:v2') || 'null');
    return project?.making?.completedColorCodes?.length || 0;
  })).toBe(1);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportCsvBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-materials\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.replace(/^\uFEFF/, '')).toMatch(/^色号,颜色名称,屏幕参考 HEX,数量,制作完成\r?\n/);
  expect(csv).toMatch(/,是\r?\n/);

  await page.reload();
  await expect(page.locator('#restoreDraftBtn')).toBeVisible();
  await page.locator('#restoreDraftBtn').click();
  await waitForPattern(page);
  await page.locator('#readyMakeBtn').click();
  await expect.poll(async () => Number(await page.locator('#makingProgressBar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(page.locator('.stat-row.is-complete')).toHaveCount(1);

  page.once('dialog', dialog=>dialog.accept());
  await page.locator('#sizeSection').evaluate((node) => { node.open = true; });
  await page.locator('[data-size="24"]').click();
  await expect(page.locator('#makingAssistant')).toBeHidden();
  await expect(page.locator('#totalBeads')).toHaveText('0');
  await page.locator('#undoBtn').click();
  await expect.poll(async () => Number((await page.locator('#totalBeads').textContent())?.replace(/\D/g,'')||0)).toBeGreaterThan(0);
  await page.locator('#readyMakeBtn').click();
  await expect.poll(async () => Number(await page.locator('#makingProgressBar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
});
