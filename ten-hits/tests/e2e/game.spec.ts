import { expect, test, type Page } from '@playwright/test';

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** One round trip instead of dozens: the page is CPU bound while rendering. */
async function readHud(page: Page) {
  return page.evaluate(() => {
    const hud = document.querySelector('[data-game-hud]');
    return {
      dotTexts: [...document.querySelectorAll('[data-hit-dot]')].map(
        (node) => (node.textContent ?? '').trim()
      ),
      proxies: [...document.querySelectorAll('[data-proxy]')].map((node) => ({
        stage: node.getAttribute('data-stage'),
        text: (node.textContent ?? '').trim()
      })),
      progressElements: document.querySelectorAll('progress, meter').length,
      text: (hud as HTMLElement | null)?.innerText ?? ''
    };
  });
}

test('start screen is usable and free of page errors', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');

  await expect(page.locator('[data-game-canvas]')).toBeVisible();
  await expect(page.locator('[data-setup-panel]')).toBeVisible();
  await expect(page.locator('[data-webgl-error]')).toHaveCount(0);
  await expect(page.locator('[data-pose-option]')).toHaveCount(6);
  await expect(page.locator('[data-view-option]')).toHaveCount(6);
  await expect(page.locator('[data-shoe-option]')).toHaveCount(3);
  await expect(page.locator('[data-start]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('every visible control meets the minimum touch target size', async ({ page }) => {
  await page.goto('/');
  // Controls inside a hidden panel (the result screen) have no box yet, so
  // only what the player can actually press is measured.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-game-hud] button')]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { label: node.textContent ?? '', w: rect.width, h: rect.height };
      })
      .filter((box) => box.w > 0 && box.h > 0)
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.h, box.label).toBeGreaterThanOrEqual(43.5);
    expect(box.w, box.label).toBeGreaterThanOrEqual(43.5);
  }
});

test('the review menu drives the camera without page errors', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');

  for (const view of ['side', 'front', 'back', 'top', 'diagonal', 'zoom']) {
    await page.locator(`[data-view-option="${view}"]`).click();
    await expect(page.locator(`[data-view-option="${view}"]`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  }

  const inspect = page.locator('[data-inspect]');
  await inspect.click();
  await expect(inspect).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(600);

  // Starting a run must leave review mode and hide the review controls.
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-review-panel]')).toBeHidden();
  await expect(inspect).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('every pose can start a run', async ({ page }) => {
  const errors = collectPageErrors(page);
  const poses = [
    'standing-front',
    'kneeling-front',
    'seated-chair',
    'spread-standing',
    'crouch-front',
    'braced-back'
  ];

  for (const pose of poses) {
    await page.goto('/');
    await page.locator(`[data-pose-option="${pose}"]`).click();
    await page.locator('[data-start]').click();
    await expect(page.locator('[data-hit-dot]')).toHaveCount(10);
    await page.waitForTimeout(300);
  }
  expect(errors).toEqual([]);
});

test('a run starts with the selected pose, shoe, and power', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');

  await page.locator('[data-pose-option="kneeling-front"]').click();
  await page.locator('[data-shoe-option="stiletto"]').click();
  await page.locator('[data-power-input]').fill('6');
  await page.locator('[data-start]').click();

  await expect(page.locator('[data-setup-panel]')).toBeHidden();
  await expect(page.locator('[data-hit-dot]')).toHaveCount(10);
  await expect(page.locator('[data-proxy]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('progress and damage are shown without any numbers', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-start]').click();
  await page.waitForTimeout(2500);

  const hud = await readHud(page);
  expect(hud.dotTexts).toHaveLength(10);
  expect(hud.dotTexts.every((text) => text === '')).toBe(true);
  expect(hud.proxies).toHaveLength(2);
  for (const proxy of hud.proxies) {
    expect(proxy.text).toBe('');
    expect(['normal', 'initial', 'damaged', 'critical', 'ruptured']).toContain(proxy.stage);
  }
  expect(hud.progressElements).toBe(0);
  expect(hud.text).not.toMatch(/\d+\s*%/);
  expect(hud.text).not.toMatch(/\d+\s*\/\s*\d+/);
});

test('the canvas follows an orientation-like viewport change', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-start]').click();
  const size = page.viewportSize()!;

  await page.setViewportSize({ width: size.height, height: size.width });
  await page.waitForTimeout(500);
  const rotated = (await page.locator('[data-game-canvas]').boundingBox())!;
  expect(Math.round(rotated.width)).toBe(size.height);
  expect(Math.round(rotated.height)).toBe(size.width);

  await page.setViewportSize(size);
  await page.waitForTimeout(500);
  const restored = (await page.locator('[data-game-canvas]').boundingBox())!;
  expect(Math.round(restored.width)).toBe(size.width);
  expect(Math.round(restored.height)).toBe(size.height);
});

test('sound and vibration toggles survive a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-toggle="sound"]').click();
  await page.locator('[data-toggle="vibration"]').click();
  await expect(page.locator('[data-toggle="sound"]')).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.locator('[data-toggle="sound"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-toggle="vibration"]')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(page.locator('[data-toggle="shake"]')).toHaveAttribute('aria-pressed', 'true');
});

test('dragging moves the player without errors', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.locator('[data-start]').click();

  const box = (await page.locator('[data-game-canvas]').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(cx + i * 12, cy);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);

  expect(errors).toEqual([]);
});

test('one full run reaches a result screen', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.locator('[data-start]').click();

  const result = page.locator('[data-result]');
  await expect(result).toBeVisible({ timeout: 270_000 });
  expect(['survived', 'ruptured']).toContain(await result.getAttribute('data-outcome'));
  await expect(page.locator('[data-retry]')).toBeVisible();
  expect(errors).toEqual([]);
});
