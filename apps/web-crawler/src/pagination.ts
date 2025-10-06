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

  async run(): Promise<void> {
    const type = this.config?.type ?? 'none';
    const maxPages = this.config?.maxPages ?? 0; // Default to 0 for unlimited
    if (type === 'none') return;

    if (type === 'infinite-scroll') {
      await this.infiniteScroll(maxPages, this.config?.scrollDelay ?? 1000);
      return;
    }

    if (type === 'load-more') {
      await this.clickLoadMore(this.config?.selector as string, maxPages);
      return;
    }

    if (type === 'next-button') {
      await this.clickNextButton(this.config?.selector as string, maxPages);
      return;
    }
  }

  private async infiniteScroll(
    maxPages: number,
    scrollDelay: number
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

      // Smooth scroll down gradually
      await this.page.evaluate(() => {
        /* eslint-disable no-undef */
        const scrollStep = window.innerHeight * 0.8;
        const scrollTo = Math.min(
          window.scrollY + scrollStep,
          document.body.scrollHeight
        );
        window.scrollTo({
          top: scrollTo,
          behavior: 'smooth',
        });
        /* eslint-enable no-undef */
      });

      await this.page.waitForTimeout(scrollDelay);
      await this.waitAfterAction();
    }
  }

  private async clickLoadMore(
    selector: string,
    maxPages: number
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
    }
  }

  private async clickNextButton(
    selector: string,
    maxPages: number
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
    }
  }
}
