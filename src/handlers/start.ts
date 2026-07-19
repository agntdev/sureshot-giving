import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, mainMenuKeyboard } from "../toolkit/index.js";

// /start — the bot's main menu. All features are reachable by tapping a button.
registerMainMenuItem({ label: "💝 Donate", data: "donation:start", order: 10 });
registerMainMenuItem({ label: "📋 Campaigns", data: "campaigns:view", order: 20 });
registerMainMenuItem({ label: "📄 My donations", data: "mydonations:view", order: 30 });
registerMainMenuItem({ label: "⚙️ Admin", data: "admin:dashboard", order: 40 });

const WELCOME = "👋 Welcome to SureShot Giving! Tap a button below to get started.";

const composer = new Composer<Ctx>();

composer.command("start", async (ctx) => {
  ctx.session.step = "idle";
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;
