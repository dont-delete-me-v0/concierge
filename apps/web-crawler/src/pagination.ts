import type { Page } from 'playwright';
import type { BasePaginationConfig } from './types.js';

export class PaginationHandler {
  constructor(
    private readonly page: Page,
    private readonly config?: BasePaginationConfig
  ) {}

  private async waitAfterAction(): Promise<void> {
    const delay = this.config?.waitAfterAction ?? 0;
    if (delay > 0) await this.page.waitForTimeout(delay);
  }

  async run(shouldStop?: () => Promise<boolean>): Promise<void> {
    const type = this.config?.type ?? 'none';
    const maxPages = this.config?.maxPages ?? 0; // Default to 0 for unlimited
    if (type === 'none') return;

    if (type === 'infinite-scroll') {
      await this.infiniteScroll(
        maxPages,
        this.config?.scrollDelay ?? 1000,
        shouldStop
      );
      return;
    }

    if (type === 'load-more') {
      await this.clickLoadMore(
        this.config?.selector as string,
        maxPages,
        shouldStop
      );
      return;
    }

    if (type === 'next-button') {
      await this.clickNextButton(
        this.config?.selector as string,
        maxPages,
        shouldStop
      );
      return;
    }
  }

  private async infiniteScroll(
    maxPages: number,
    scrollDelay: number,
    shouldStop?: () => Promise<boolean>
  ): Promise<void> {
    let attempts = 0;
    const hasMaxPages = maxPages > 0;
    const maxAttempts = hasMaxPages ? maxPages : 1000; // Large number for unlimited

    console.log(
      `Starting infinite scroll${hasMaxPages ? ` (max ${maxPages} attempts)` : ' (unlimited)'}`
    );

    while (attempts < maxAttempts) {
      attempts++;

      // Get current scroll position and page height
      const { scrollY, scrollHeight, innerHeight } = await this.page.evaluate(
        () => {
          /* eslint-disable no-undef */
          return {
            scrollY: window.scrollY,
            scrollHeight: document.body.scrollHeight,
            innerHeight: window.innerHeight,
          };
          /* eslint-enable no-undef */
        }
      );

      console.log(
        `Scroll attempt ${attempts}${hasMaxPages ? `/${maxAttempts}` : ''}, position: ${scrollY}/${scrollHeight}`
      );

      // Check if we're already at the bottom (only stopping condition)
      if (scrollY + innerHeight >= scrollHeight - 100) {
        console.log('Reached bottom of page, stopping scroll');
        break;
      }

      // Random scroll behavior
      await this.performRandomScroll(innerHeight, scrollHeight, scrollY);

      // Random delay with ±30% variation
      const randomDelay = scrollDelay * (0.7 + Math.random() * 0.6);
      await this.page.waitForTimeout(randomDelay);

      await this.waitAfterAction();
      if (shouldStop && (await shouldStop().catch(() => false))) {
        console.log('Stop condition met during infinite scroll');
        break;
      }
    }
  }

  private async performRandomScroll(
    innerHeight: number,
    scrollHeight: number,
    currentScrollY: number
  ): Promise<void> {
    const random = Math.random();

    // 5% chance of scrolling backward
    if (random < 0.05) {
      await this.scrollBackward(innerHeight, currentScrollY);
      return;
    }

    // 10% chance of long pause (no scroll)
    if (random < 0.15) {
      console.log('Taking a long pause...');
      await this.page.waitForTimeout(2000 + Math.random() * 3000);
      return;
    }

    // 30% chance of mouse movement
    if (random < 0.45) {
      await this.performMouseMovement();
    }

    // Normal forward scroll with random step (50-80% of viewport)
    await this.scrollForward(innerHeight, scrollHeight, currentScrollY);
  }

  private async scrollForward(
    innerHeight: number,
    scrollHeight: number,
    currentScrollY: number
  ): Promise<void> {
    // Random step between 50-80% of viewport height
    const stepRatio = 0.5 + Math.random() * 0.3;
    const scrollStep = innerHeight * stepRatio;

    await this.page.evaluate(step => {
      /* eslint-disable no-undef */
      const scrollTo = Math.min(
        window.scrollY + step,
        document.body.scrollHeight
      );
      window.scrollTo({
        top: scrollTo,
        behavior: 'smooth',
      });
      /* eslint-enable no-undef */
    }, scrollStep);
  }

  private async scrollBackward(
    innerHeight: number,
    currentScrollY: number
  ): Promise<void> {
    console.log('Scrolling backward...');
    const backwardStep = innerHeight * (0.2 + Math.random() * 0.3); // 20-50% of viewport
    const scrollTo = Math.max(0, currentScrollY - backwardStep);

    await this.page.evaluate(targetY => {
      /* eslint-disable no-undef */
      window.scrollTo({
        top: targetY,
        behavior: 'smooth',
      });
      /* eslint-enable no-undef */
    }, scrollTo);
  }

  private async performMouseMovement(): Promise<void> {
    console.log('Performing mouse movement...');
    const viewport = await this.page.viewportSize();
    if (!viewport) return;

    // Random mouse movement within viewport
    const startX = Math.random() * viewport.width;
    const startY = Math.random() * viewport.height;
    const endX = Math.random() * viewport.width;
    const endY = Math.random() * viewport.height;

    await this.page.mouse.move(startX, startY);
    await this.page.waitForTimeout(100 + Math.random() * 200);
    await this.page.mouse.move(endX, endY);
  }

  private async clickLoadMore(
    selector: string,
    maxPages: number,
    shouldStop?: () => Promise<boolean>
  ): Promise<void> {
    if (!selector) return;
    const hasMaxPages = maxPages > 0;
    const maxAttempts = hasMaxPages ? maxPages : 1000;
    let attempts = 0;

    console.log(
      `Starting load-more pagination${hasMaxPages ? ` (max ${maxPages} clicks)` : ' (unlimited)'}`
    );

    while (attempts < maxAttempts) {
      attempts++;

      const button = this.page.locator(selector).first();
      const visible = await button.isVisible().catch(() => false);

      console.log(
        `Load-more attempt ${attempts}${hasMaxPages ? `/${maxAttempts}` : ''}, button visible: ${visible}`
      );

      if (!visible) {
        console.log('Load-more button not found, stopping pagination');
        break;
      }

      await button.click({ timeout: 5000 }).catch(() => undefined);
      await this.waitAfterAction();
      if (shouldStop && (await shouldStop().catch(() => false))) {
        console.log('Stop condition met during load-more pagination');
        break;
      }
    }
  }

  private async clickNextButton(
    selector: string,
    maxPages: number,
    shouldStop?: () => Promise<boolean>
  ): Promise<void> {
    if (!selector) return;
    const hasMaxPages = maxPages > 0;
    const maxAttempts = hasMaxPages ? maxPages : 1000;
    let attempts = 0;

    console.log(
      `Starting next-button pagination${hasMaxPages ? ` (max ${maxPages} clicks)` : ' (unlimited)'}`
    );

    while (attempts < maxAttempts) {
      attempts++;

      const btn = this.page.locator(selector).first();
      const enabled = await btn.isEnabled().catch(() => false);

      console.log(
        `Next-button attempt ${attempts}${hasMaxPages ? `/${maxAttempts}` : ''}, button enabled: ${enabled}`
      );

      if (!enabled) {
        console.log('Next-button not enabled, stopping pagination');
        break;
      }

      await btn.click({ timeout: 5000 }).catch(() => undefined);
      await this.waitAfterAction();
      if (shouldStop && (await shouldStop().catch(() => false))) {
        console.log('Stop condition met during next-button pagination');
        break;
      }
    }
  }
}
