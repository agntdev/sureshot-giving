import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { getStore } from "../lib/store.js";

// Campaign listing — shows active campaigns with progress indicators.
// Reachable via /campaigns command OR the "📋 Campaigns" main-menu button.

const STORE = getStore();
const CAMPAIGNS_PER_PAGE = 5;

registerMainMenuItem({ label: "📋 Campaigns", data: "campaigns:view", order: 20 });

const composer = new Composer<Ctx>();

function progressBar(raised: number, goal: number): string {
  if (goal <= 0) return "[          ]";
  const pct = Math.min(1, raised / goal);
  const filled = Math.round(pct * 10);
  return "[" + "█".repeat(filled) + "░".repeat(10 - filled) + "]";
}

async function renderCampaigns(ctx: Ctx, page: number): Promise<void> {
  const campaigns = await STORE.listActiveCampaigns();
  if (campaigns.length === 0) {
    await ctx.reply("No active campaigns right now — check back soon!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const { pageItems, page: actualPage, totalPages, controls } = paginate(campaigns, {
    page,
    perPage: CAMPAIGNS_PER_PAGE,
    callbackPrefix: "campaigns:page",
    prevLabel: "« Prev",
    nextLabel: "Next »",
  });

  const lines: string[] = ["📋 Active campaigns:"];
  for (const c of pageItems) {
    lines.push("");
    lines.push(`${c.name}`);
    lines.push(`Goal: ${c.goal} ${c.currency} | Raised: ${c.raised} ${c.currency}`);
    lines.push(progressBar(c.raised, c.goal));
  }

  if (totalPages > 1) {
    lines.push("");
    lines.push(`Page ${actualPage + 1} of ${totalPages}`);
  }

  const rows = pageItems.map((c) => [
    inlineButton(`💝 Donate to ${c.name}`, `donation:campaign:${c.id}`),
  ]);

  const kb = inlineKeyboard([...rows, ...controls.inline_keyboard, [inlineButton("⬅️ Back to menu", "menu:main")]]);
  await ctx.reply(lines.join("\n"), { reply_markup: kb });
}

composer.command("campaigns", async (ctx) => {
  await renderCampaigns(ctx, 0);
});

composer.callbackQuery("campaigns:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderCampaigns(ctx, 0);
});

composer.callbackQuery(/^campaigns:page:prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match![1], 10);
  await renderCampaigns(ctx, page);
});

composer.callbackQuery(/^campaigns:page:next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match![1], 10);
  await renderCampaigns(ctx, page);
});

export default composer;
