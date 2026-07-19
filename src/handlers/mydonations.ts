import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { getStore } from "../lib/store.js";

// My donations — shows the user's donation history with status and receipt info.
// Reachable via /mydonations command OR the "📄 My donations" main-menu button.

const STORE = getStore();
const DONATIONS_PER_PAGE = 5;

registerMainMenuItem({ label: "📄 My donations", data: "mydonations:view", order: 30 });

const composer = new Composer<Ctx>();

function statusIcon(status: string): string {
  if (status === "completed") return "✅";
  if (status === "pending") return "⏳";
  return "❌";
}

async function renderDonations(ctx: Ctx, page: number): Promise<void> {
  const donor = await STORE.getDonorByTelegramId(ctx.from!.id);
  if (!donor || donor.donationIds.length === 0) {
    await ctx.reply("No donations yet — tap 💝 Donate to make your first gift!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const donations = await STORE.getDonationsByDonor(donor.id);
  if (donations.length === 0) {
    await ctx.reply("No donations yet — tap 💝 Donate to make your first gift!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const { pageItems, page: actualPage, totalPages, controls } = paginate(donations, {
    page,
    perPage: DONATIONS_PER_PAGE,
    callbackPrefix: "mydonations:page",
    prevLabel: "« Prev",
    nextLabel: "Next »",
  });

  const lines: string[] = ["📄 Your donation history:"];
  for (const d of pageItems) {
    const campaign = await STORE.getCampaign(d.campaignId);
    const campaignName = campaign?.name ?? "Unknown";
    const recurring = d.recurring ? " (monthly)" : "";
    lines.push("");
    lines.push(`${statusIcon(d.status)} ${d.amount} ${d.currency} to ${campaignName}${recurring}`);
    lines.push(`   ${new Date(d.timestamp).toLocaleDateString()}`);
  }

  if (totalPages > 1) {
    lines.push("");
    lines.push(`Page ${actualPage + 1} of ${totalPages}`);
  }

  const kb = inlineKeyboard([...controls.inline_keyboard, [inlineButton("⬅️ Back to menu", "menu:main")]]);
  await ctx.reply(lines.join("\n"), { reply_markup: kb });
}

composer.command("mydonations", async (ctx) => {
  await renderDonations(ctx, 0);
});

composer.callbackQuery("mydonations:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderDonations(ctx, 0);
});

composer.callbackQuery(/^mydonations:page:prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match![1], 10);
  await renderDonations(ctx, page);
});

composer.callbackQuery(/^mydonations:page:next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match![1], 10);
  await renderDonations(ctx, page);
});

export default composer;
