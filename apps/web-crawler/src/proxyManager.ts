import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export class ProxyManager {
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;
  private failedProxies = new Set<string>();
  private proxyUsageCount = new Map<string, number>();
  private readonly maxFailuresPerProxy = 3;

  async loadProxies(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

      this.proxies = lines.map(line => this.parseProxyLine(line));
      console.log(`Loaded ${this.proxies.length} proxies from ${filePath}`);
    } catch (err) {
      console.warn(`Failed to load proxies from ${filePath}:`, err);
      this.proxies = [];
    }
  }

  private parseProxyLine(line: string): ProxyConfig {
    // Format: ip:port:username:password or ip:port
    const parts = line.split(':');
    if (parts.length < 2) {
      throw new Error(`Invalid proxy format: ${line}`);
    }

    const [host, portStr, username, password] = parts;
    const port = parseInt(portStr, 10);

    if (!host || isNaN(port)) {
      throw new Error(`Invalid proxy format: ${line}`);
    }

    return {
      host,
      port,
      username,
      password,
    };
  }

  getNext(): ProxyConfig | null {
    if (this.proxies.length === 0) {
      return null;
    }

    // Filter out failed proxies
    const availableProxies = this.proxies.filter(
      proxy => !this.failedProxies.has(this.getProxyKey(proxy))
    );

    if (availableProxies.length === 0) {
      console.warn('All proxies have failed, resetting failure tracking');
      this.failedProxies.clear();
      return this.proxies[0];
    }

    // Round-robin selection
    const proxy = availableProxies[this.currentIndex % availableProxies.length];
    this.currentIndex = (this.currentIndex + 1) % availableProxies.length;

    const key = this.getProxyKey(proxy);
    this.proxyUsageCount.set(key, (this.proxyUsageCount.get(key) || 0) + 1);

    return proxy;
  }

  getRandom(): ProxyConfig | null {
    if (this.proxies.length === 0) {
      return null;
    }

    const availableProxies = this.proxies.filter(
      proxy => !this.failedProxies.has(this.getProxyKey(proxy))
    );

    if (availableProxies.length === 0) {
      console.warn('All proxies have failed, resetting failure tracking');
      this.failedProxies.clear();
      return this.proxies[Math.floor(Math.random() * this.proxies.length)];
    }

    const randomIndex = Math.floor(Math.random() * availableProxies.length);
    const proxy = availableProxies[randomIndex];

    const key = this.getProxyKey(proxy);
    this.proxyUsageCount.set(key, (this.proxyUsageCount.get(key) || 0) + 1);

    return proxy;
  }

  markFailed(proxy: ProxyConfig): void {
    const key = this.getProxyKey(proxy);
    const currentFailures = this.proxyUsageCount.get(key) || 0;

    if (currentFailures >= this.maxFailuresPerProxy) {
      this.failedProxies.add(key);
      console.warn(
        `Proxy ${key} marked as failed after ${currentFailures} attempts`
      );
    }
  }

  formatProxyUrl(proxy: ProxyConfig): string {
    if (proxy.username && proxy.password) {
      return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
    }
    return `http://${proxy.host}:${proxy.port}`;
  }

  getProxyKey(proxy: ProxyConfig): string {
    return `${proxy.host}:${proxy.port}`;
  }

  getStats(): {
    total: number;
    available: number;
    failed: number;
    usage: Map<string, number>;
  } {
    return {
      total: this.proxies.length,
      available: this.proxies.length - this.failedProxies.size,
      failed: this.failedProxies.size,
      usage: new Map(this.proxyUsageCount),
    };
  }

  hasProxies(): boolean {
    return this.proxies.length > 0;
  }
}
