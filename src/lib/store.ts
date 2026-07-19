// Persistent data store for the SureShot Giving Donation Bot.
// Uses Redis when REDIS_URL is set, otherwise in-memory for development.
// All domain data (donors, donations, campaigns, admin config) goes here —
// never in session state or in-memory module-level variables.

import { createRequire } from "node:module";
import type { RedisLike } from "../toolkit/session/redis.js";
import { MemorySessionStorage } from "../toolkit/session/memory.js";

// ── Data types ──────────────────────────────────────────────────────────────

export interface Donor {
  id: string;
  telegramId: number;
  displayName: string;
  email?: string;
  donationIds: string[];
  createdAt: string;
}

export interface Donation {
  id: string;
  donorId: string;
  amount: number;
  currency: string;
  timestamp: string;
  status: "pending" | "completed" | "failed";
  campaignId: string;
  recurring: boolean;
  stripeSessionId?: string;
  receiptSent: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  goal: number;
  raised: number;
  currency: string;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export interface AdminConfig {
  ownerTelegramId: number;
  notifyOnDonation: boolean;
  weeklyReport: boolean;
  defaultCurrency: string;
}

export interface WebhookEvent {
  id: string;
  eventType: string;
  paymentReference: string;
  timestamp: string;
  processed: boolean;
}

// ── Storage adapter (Redis or in-memory) ────────────────────────────────────

interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

class MemoryKV implements KVStore {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
  async del(key: string) { this.store.delete(key); }
  async keys(pattern: string) {
    const prefix = pattern.replace(/\*$/, "");
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
}

function makeRedisKV(url: string): KVStore {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ioredis: any = require("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  return {
    async get(key) { return client.get(key); },
    async set(key, value) { await client.set(key, value); },
    async del(key) { await client.del(key); },
    async keys(pattern) { return client.keys(pattern); },
  };
}

// ── Store class ─────────────────────────────────────────────────────────────

export class Store {
  private kv: KVStore;

  constructor(kv?: KVStore) {
    this.kv = kv ?? new MemoryKV();
  }

  static fromEnv(): Store {
    const url = process.env.REDIS_URL;
    if (url) return new Store(makeRedisKV(url));
    return new Store();
  }

  private async read<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.kv.set(key, JSON.stringify(value));
  }

  private async remove(key: string): Promise<void> {
    await this.kv.del(key);
  }

  // ── Index management ────────────────────────────────────────────────────

  private async getIndex(key: string): Promise<string[]> {
    return (await this.read<string[]>(key)) ?? [];
  }

  private async addToIndex(key: string, id: string): Promise<void> {
    const ids = await this.getIndex(key);
    if (!ids.includes(id)) {
      ids.push(id);
      await this.write(key, ids);
    }
  }

  private async removeFromIndex(key: string, id: string): Promise<void> {
    const ids = await this.getIndex(key);
    const filtered = ids.filter((i) => i !== id);
    await this.write(key, filtered);
  }

  // ── Donors ──────────────────────────────────────────────────────────────

  async saveDonor(donor: Donor): Promise<void> {
    await this.write(`donor:${donor.id}`, donor);
    await this.addToIndex("idx:donors", donor.id);
    await this.addToIndex(`idx:donor:tg:${donor.telegramId}`, donor.id);
  }

  async getDonor(id: string): Promise<Donor | null> {
    return this.read<Donor>(`donor:${id}`);
  }

  async getDonorByTelegramId(telegramId: number): Promise<Donor | null> {
    const ids = await this.getIndex(`idx:donor:tg:${telegramId}`);
    if (ids.length === 0) return null;
    return this.getDonor(ids[0]);
  }

  async addDonationToDonor(donorId: string, donationId: string): Promise<void> {
    const donor = await this.getDonor(donorId);
    if (donor && !donor.donationIds.includes(donationId)) {
      donor.donationIds.push(donationId);
      await this.saveDonor(donor);
    }
  }

  // ── Donations ───────────────────────────────────────────────────────────

  async saveDonation(donation: Donation): Promise<void> {
    await this.write(`donation:${donation.id}`, donation);
    await this.addToIndex("idx:donations", donation.id);
    await this.addToIndex(`idx:donations:donor:${donation.donorId}`, donation.id);
    await this.addToIndex(`idx:donations:campaign:${donation.campaignId}`, donation.id);
  }

  async getDonation(id: string): Promise<Donation | null> {
    return this.read<Donation>(`donation:${id}`);
  }

  async getDonationsByDonor(donorId: string): Promise<Donation[]> {
    const ids = await this.getIndex(`idx:donations:donor:${donorId}`);
    const donations: Donation[] = [];
    for (const id of ids) {
      const d = await this.getDonation(id);
      if (d) donations.push(d);
    }
    return donations.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  async getDonationsByCampaign(campaignId: string): Promise<Donation[]> {
    const ids = await this.getIndex(`idx:donations:campaign:${campaignId}`);
    const donations: Donation[] = [];
    for (const id of ids) {
      const d = await this.getDonation(id);
      if (d) donations.push(d);
    }
    return donations;
  }

  async listAllDonations(): Promise<Donation[]> {
    const ids = await this.getIndex("idx:donations");
    const donations: Donation[] = [];
    for (const id of ids) {
      const d = await this.getDonation(id);
      if (d) donations.push(d);
    }
    return donations.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  // ── Campaigns ───────────────────────────────────────────────────────────

  async saveCampaign(campaign: Campaign): Promise<void> {
    await this.write(`campaign:${campaign.id}`, campaign);
    await this.addToIndex("idx:campaigns", campaign.id);
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    return this.read<Campaign>(`campaign:${id}`);
  }

  async listActiveCampaigns(): Promise<Campaign[]> {
    const ids = await this.getIndex("idx:campaigns");
    const campaigns: Campaign[] = [];
    for (const id of ids) {
      const c = await this.getCampaign(id);
      if (c && c.active) campaigns.push(c);
    }
    return campaigns.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async listAllCampaigns(): Promise<Campaign[]> {
    const ids = await this.getIndex("idx:campaigns");
    const campaigns: Campaign[] = [];
    for (const id of ids) {
      const c = await this.getCampaign(id);
      if (c) campaigns.push(c);
    }
    return campaigns.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async updateCampaignRaised(campaignId: string, amount: number): Promise<void> {
    const campaign = await this.getCampaign(campaignId);
    if (campaign) {
      campaign.raised += amount;
      await this.saveCampaign(campaign);
    }
  }

  // ── Admin config ────────────────────────────────────────────────────────

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    await this.write("admin:config", config);
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.read<AdminConfig>("admin:config");
  }

  // ── Webhook events ──────────────────────────────────────────────────────

  async saveWebhookEvent(event: WebhookEvent): Promise<void> {
    await this.write(`webhook:${event.id}`, event);
    await this.addToIndex("idx:webhooks", event.id);
  }

  async getWebhookEvent(id: string): Promise<WebhookEvent | null> {
    return this.read<WebhookEvent>(`webhook:${id}`);
  }

  async updateWebhookEvent(id: string, updates: Partial<WebhookEvent>): Promise<void> {
    const event = await this.getWebhookEvent(id);
    if (event) {
      Object.assign(event, updates);
      await this.saveWebhookEvent(event);
    }
  }

  // ── ID generation ───────────────────────────────────────────────────────

  generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

// ── Singleton store instance ────────────────────────────────────────────────

let _store: Store | null = null;

export function getStore(): Store {
  if (!_store) _store = Store.fromEnv();
  return _store;
}
