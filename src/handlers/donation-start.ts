import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, confirmKeyboard } from "../toolkit/index.js";
import { getStore } from "../lib/store.js";

// Donation flow — multi-step wizard: campaign selection → amount → email → confirm → Stripe payment link.
// Uses session steps to track where the user is in the flow.

const STORE = getStore();

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const composer = new Composer<Ctx>();

// ── Entry: show campaign selection ─────────────────────────────────────────

composer.callbackQuery("donation:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "select_campaign";
  ctx.session.campaignId = undefined;
  ctx.session.amount = undefined;
  ctx.session.recurring = undefined;
  ctx.session.email = undefined;

  const campaigns = await STORE.listActiveCampaigns();
  if (campaigns.length === 0) {
    await ctx.reply("No active campaigns right now — check back soon!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const rows = campaigns.map((c) => [
    inlineButton(c.name, `donation:campaign:${c.id}`),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.reply("Pick a campaign to support:", {
    reply_markup: inlineKeyboard(rows),
  });
});

// ── Step 1: user picked a campaign → ask for amount ────────────────────────

composer.callbackQuery(/^donation:campaign:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const campaignId = ctx.match![1];
  const campaign = await STORE.getCampaign(campaignId);
  if (!campaign || !campaign.active) {
    await ctx.reply("That campaign isn't available anymore. Pick another one.");
    return;
  }
  ctx.session.campaignId = campaignId;
  ctx.session.step = "awaiting_amount";
  await ctx.reply(
    `Great choice! How much would you like to donate to ${campaign.name}?\n\nType an amount (e.g. 10, 25, 50).`,
  );
});

// ── Step 2: amount entered → ask about recurring ───────────────────────────

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_amount") return next();
  const text = ctx.message.text.trim();
  const amount = parseFloat(text);

  if (isNaN(amount) || amount < 1) {
    await ctx.reply("Please enter a valid amount of at least 1.");
    return;
  }

  ctx.session.amount = amount;
  ctx.session.step = "awaiting_email";
  await ctx.reply("Would you like this to be a monthly recurring donation?", {
    reply_markup: confirmKeyboard("donation:recurring", {
      yes: "🔄 Yes, monthly",
      no: " One-time only",
    }),
  });
});

// ── Step 3a: recurring choice → ask for email ──────────────────────────────

composer.callbackQuery("donation:recurring:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.recurring = true;
  ctx.session.step = "awaiting_email";
  await ctx.reply("Got it — monthly recurring. What's your email for the receipt? (or tap Skip to skip)", {
    reply_markup: inlineKeyboard([[inlineButton("Skip", "donation:email:skip")]]),
  });
});

composer.callbackQuery("donation:recurring:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.recurring = false;
  ctx.session.step = "awaiting_email";
  await ctx.reply("One-time donation it is. What's your email for the receipt? (or tap Skip to skip)", {
    reply_markup: inlineKeyboard([[inlineButton("Skip", "donation:email:skip")]]),
  });
});

// ── Step 3b: email entered or skipped → show confirmation ──────────────────

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_email") return next();
  const email = ctx.message.text.trim();
  if (!email.includes("@")) {
    await ctx.reply("That doesn't look like an email — try again.");
    return;
  }
  ctx.session.email = email;
  ctx.session.step = "confirming";
  await showConfirmation(ctx);
});

composer.callbackQuery("donation:email:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.email = undefined;
  ctx.session.step = "confirming";
  await showConfirmation(ctx);
});

async function showConfirmation(ctx: Ctx) {
  const campaign = await STORE.getCampaign(ctx.session.campaignId!);
  const campaignName = campaign?.name ?? "Unknown campaign";
  const amount = ctx.session.amount!;
  const currency = "USD";
  const recurring = ctx.session.recurring;

  const lines = [
    `Campaign: ${campaignName}`,
    `Amount: ${amount} ${currency}`,
    recurring ? "Monthly recurring" : "One-time donation",
    "",
    "Ready to donate?",
  ];

  await ctx.reply(lines.join("\n"), {
    reply_markup: confirmKeyboard("donation:confirm"),
  });
}

// ── Step 4: confirm → create Stripe session → payment link ─────────────────

composer.callbackQuery("donation:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const { campaignId, amount, recurring, email } = ctx.session;
  if (!campaignId || !amount) {
    await ctx.reply("Something went wrong. Tap /start to begin again.");
    ctx.session.step = "idle";
    return;
  }

  const campaign = await STORE.getCampaign(campaignId);
  const currency = "USD";
  const donorName = ctx.from?.first_name ?? "Donor";

  // Create or update donor record
  let donor = await STORE.getDonorByTelegramId(ctx.from!.id);
  if (!donor) {
    donor = {
      id: STORE.generateId(),
      telegramId: ctx.from!.id,
      displayName: donorName,
      email,
      donationIds: [],
      createdAt: new Date().toISOString(),
    };
    await STORE.saveDonor(donor);
  } else if (email) {
    donor.email = email;
    await STORE.saveDonor(donor);
  }

  // Create Stripe checkout session
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  let checkoutUrl: string | null = null;
  let stripeSessionId: string | undefined;

  if (stripeKey) {
    try {
      const params = new URLSearchParams();
      params.append("mode", recurring ? "subscription" : "payment");
        params.append("success_url", "https://t.me/" + "SureShotGivingBot" + "?start=donated");
        params.append("cancel_url", "https://t.me/" + "SureShotGivingBot" + "?start=cancel");
      params.append("line_items[0][price_data][currency]", currency.toLowerCase());
      params.append("line_items[0][price_data][product_data][name]", campaign?.name ?? "Donation");
      params.append("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
      params.append("line_items[0][quantity]", "1");
      params.append("metadata[donor_id]", donor.id);
      params.append("metadata[campaign_id]", campaignId);
      params.append("metadata[recurring]", String(!!recurring));

      const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      const data = await resp.json() as { id?: string; url?: string; error?: { message?: string } };
      if (data.id && data.url) {
        checkoutUrl = data.url;
        stripeSessionId = data.id;
      }
    } catch {
      // Stripe not configured or network issue — fall through to manual message
    }
  }

  // Save donation record
  const donation = {
    id: STORE.generateId(),
    donorId: donor.id,
    amount,
    currency,
    timestamp: new Date().toISOString(),
    status: "pending" as const,
    campaignId,
    recurring: !!recurring,
    stripeSessionId,
    receiptSent: false,
  };
  await STORE.saveDonation(donation);
  await STORE.addDonationToDonor(donor.id, donation.id);

  // Update campaign raised amount
  await STORE.updateCampaignRaised(campaignId, amount);

  // Update campaign's donation list in the index
  ctx.session.step = "idle";

  const campaignName = campaign?.name ?? "Unknown";
  const recurringText = recurring ? "\n🔄 Monthly recurring" : "";

  if (checkoutUrl) {
    await ctx.reply(
      `Thanks for your ${amount} ${currency} donation to ${campaignName}!${recurringText}\n\nTap the button below to complete your payment.`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("💳 Pay now", checkoutUrl)],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
  } else {
    await ctx.reply(
      `Thanks for your ${amount} ${currency} donation to ${campaignName}!${recurringText}\n\nPayment link is being generated. Please try again later or contact support.`,
      {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      },
    );
  }
});

composer.callbackQuery("donation:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.reply("Donation cancelled. Tap /start to begin again.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// ── Allow re-entering amount ────────────────────────────────────────────────

composer.callbackQuery("donation:amount:other", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_amount";
  await ctx.reply("Type your donation amount:");
});

export default composer;
