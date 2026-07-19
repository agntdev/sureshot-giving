import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { getStore } from "../lib/store.js";

// Admin dashboard — campaign management, donation viewing, CSV export.
// Only accessible by the bot owner (OWNER_ID env var).

const STORE = getStore();
const DONATIONS_PER_PAGE = 10;

registerMainMenuItem({ label: "⚙️ Admin", data: "admin:dashboard", order: 40 });

function isAdmin(ctx: Ctx): boolean {
  const ownerId = process.env.OWNER_ID;
  return ownerId ? ctx.from?.id === Number(ownerId) : false;
}

const composer = new Composer<Ctx>();

// ── /admin command — show dashboard ────────────────────────────────────────

composer.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply("You don't have admin access.");
    return;
  }
  await ctx.reply("⚙️ Admin dashboard", {
    reply_markup: inlineKeyboard([
      [inlineButton("➕ Create campaign", "admin:create"), inlineButton("📋 All campaigns", "admin:list")],
      [inlineButton("📄 All donations", "admin:donations"), inlineButton("📥 Export CSV", "admin:export")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

// ── Dashboard callback ─────────────────────────────────────────────────────

composer.callbackQuery("admin:dashboard", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) {
    await ctx.reply("You don't have admin access.");
    return;
  }
  await ctx.editMessageText("⚙️ Admin dashboard", {
    reply_markup: inlineKeyboard([
      [inlineButton("➕ Create campaign", "admin:create"), inlineButton("📋 All campaigns", "admin:list")],
      [inlineButton("📄 All donations", "admin:donations"), inlineButton("📥 Export CSV", "admin:export")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

// ── Create campaign flow ───────────────────────────────────────────────────

composer.callbackQuery("admin:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;
  ctx.session.step = "admin_awaiting_name";
  await ctx.reply("What's the campaign name?");
});

composer.on("message:text", async (ctx, next) => {
  if (!isAdmin(ctx)) return next();
  const step = ctx.session.step;

  if (step === "admin_awaiting_name") {
    const name = ctx.message.text.trim();
    if (name.length < 2 || name.length > 50) {
      await ctx.reply("Name should be 2–50 characters. Try again.");
      return;
    }
    ctx.session.campaignId = name; // temp storage
    ctx.session.step = "admin_awaiting_goal";
    await ctx.reply("What's the fundraising goal? (e.g. 1000)");
    return;
  }

  if (step === "admin_awaiting_goal") {
    const goal = parseFloat(ctx.message.text.trim());
    if (isNaN(goal) || goal < 1) {
      await ctx.reply("Please enter a valid amount of at least 1.");
      return;
    }
    ctx.session.amount = goal; // temp storage
    ctx.session.step = "admin_awaiting_description";
    await ctx.reply("Short description for the campaign:");
    return;
  }

  if (step === "admin_awaiting_description") {
    const desc = ctx.message.text.trim();
    if (!desc) {
      await ctx.reply("Please enter a description.");
      return;
    }
    ctx.session.email = desc; // temp storage
    ctx.session.step = "admin_awaiting_start_date";
    await ctx.reply("Start date (YYYY-MM-DD):");
    return;
  }

  if (step === "admin_awaiting_start_date") {
    const dateStr = ctx.message.text.trim();
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      await ctx.reply("Invalid date format. Use YYYY-MM-DD.");
      return;
    }
    ctx.session.currency = dateStr; // temp storage
    ctx.session.step = "admin_awaiting_end_date";
    await ctx.reply("End date (YYYY-MM-DD):");
    return;
  }

  if (step === "admin_awaiting_end_date") {
    const dateStr = ctx.message.text.trim();
    const endDate = new Date(dateStr);
    if (isNaN(endDate.getTime())) {
      await ctx.reply("Invalid date format. Use YYYY-MM-DD.");
      return;
    }
    const startDate = new Date(ctx.session.currency!);
    if (endDate <= startDate) {
      await ctx.reply("End date must be after start date. Try again.");
      return;
    }

    const campaign = {
      id: STORE.generateId(),
      name: ctx.session.campaignId!,
      description: ctx.session.email!,
      goal: ctx.session.amount!,
      raised: 0,
      currency: "USD",
      startDate: ctx.session.currency!,
      endDate: dateStr,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await STORE.saveCampaign(campaign);

    ctx.session.step = "idle";
    ctx.session.campaignId = undefined;
    ctx.session.amount = undefined;
    ctx.session.email = undefined;
    ctx.session.currency = undefined;

    await ctx.reply(`Campaign "${campaign.name}" created! 🎉`, {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  return next();
});

// ── Cancel campaign creation ────────────────────────────────────────────────

composer.callbackQuery("admin:create:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.campaignId = undefined;
  ctx.session.amount = undefined;
  ctx.session.email = undefined;
  ctx.session.currency = undefined;
  await ctx.reply("Campaign creation cancelled.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// ── List all campaigns ──────────────────────────────────────────────────────

composer.callbackQuery("admin:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;

  const campaigns = await STORE.listAllCampaigns();
  if (campaigns.length === 0) {
    await ctx.reply("No campaigns yet. Create one first!", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Create campaign", "admin:create")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const lines = ["📋 All campaigns:"];
  for (const c of campaigns) {
    const status = c.active ? "🟢" : "🔴";
    lines.push(`${status} ${c.name} — ${c.raised}/${c.goal} ${c.currency}`);
  }

  await ctx.reply(lines.join("\n"), {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// ── View all donations ──────────────────────────────────────────────────────

composer.callbackQuery("admin:donations", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;
  await renderAdminDonations(ctx, 0);
});

composer.callbackQuery(/^admin:donations:page:prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match![1], 10);
  await renderAdminDonations(ctx, page);
});

composer.callbackQuery(/^admin:donations:page:next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match![1], 10);
  await renderAdminDonations(ctx, page);
});

async function renderAdminDonations(ctx: Ctx, page: number): Promise<void> {
  const donations = await STORE.listAllDonations();
  if (donations.length === 0) {
    await ctx.reply("No donations recorded yet.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const { pageItems, page: actualPage, totalPages, controls } = paginate(donations, {
    page,
    perPage: DONATIONS_PER_PAGE,
    callbackPrefix: "admin:donations:page",
    prevLabel: "« Prev",
    nextLabel: "Next »",
  });

  const lines = ["📄 All donations:"];
  for (const d of pageItems) {
    const campaign = await STORE.getCampaign(d.campaignId);
    const status = d.status === "completed" ? "✅" : d.status === "pending" ? "⏳" : "❌";
    lines.push(`${status} ${d.amount} ${d.currency} → ${campaign?.name ?? "Unknown"} (${new Date(d.timestamp).toLocaleDateString()})`);
  }

  if (totalPages > 1) {
    lines.push("");
    lines.push(`Page ${actualPage + 1} of ${totalPages}`);
  }

  const kb = inlineKeyboard([...controls.inline_keyboard, [inlineButton("⬅️ Back to menu", "menu:main")]]);
  await ctx.reply(lines.join("\n"), { reply_markup: kb });
}

// ── Export CSV ──────────────────────────────────────────────────────────────

composer.callbackQuery("admin:export", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;

  const donations = await STORE.listAllDonations();
  if (donations.length === 0) {
    await ctx.reply("No donations to export.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const header = "ID,Donor ID,Amount,Currency,Status,Campaign ID,Recurring,Timestamp,Receipt Sent";
  const rows = donations.map((d) =>
    [d.id, d.donorId, d.amount, d.currency, d.status, d.campaignId, d.recurring, d.timestamp, d.receiptSent].join(","),
  );
  const csv = header + "\n" + rows.join("\n");

  const chatId = ctx.chat!.id;
  await ctx.api.sendDocument(chatId, new InputFile(Buffer.from(csv, "utf-8"), "donations.csv"), {
    caption: `Exported ${donations.length} donation(s).`,
  });
  // Send a follow-up message with back button (since sendDocument doesn't support inline_keyboard directly)
  await ctx.reply("Export complete!", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

export default composer;
