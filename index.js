const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const CronJob = require("cron").CronJob;
const db = require("./db/db.js");

require("dotenv").config();

const bot = new TelegramBot(process.env.API_KEY_BOT, {
  polling: true,
});

console.log("Bot server is working ...");

const initApp = function (/* bdSubs */) {
  // // Iterate subscriptions, keep references in memory and start its cronjob for notification
  // for ( let i = 0, len = bdSubs.length; i < len; i++ ) {
  //     subscriptions.add( bdSubs[ i ] );
  //     crontab.start( bdSubs[ i ], bdSubs[ i ].chatId, checkWeather );
  // }

  // Once each subscription has its cronjob, initialize Telegram bot
  initBot();
};

const initBot = function () {
  const commands = [
    { command: "subscribe", description: "Оформить подписку" },
    { command: "unsubscribe", description: "Прервать подписку" },
    { command: "history", description: "История списаний" },
  ];

  bot.setMyCommands(commands);

  bot.on("text", async (msg) => {
    try {
      if (msg.text.startsWith("/start")) {
        await bot.sendMessage(
          msg.chat.id,
          "Добро пожаловать! Выберите необходимое действие в меню"
        );
        // console.log(await db.getTimeSubscription(2));
        // await bot.sendMessage(msg.chat.id, m);
      } else if (msg.text == "/subscribe") {
        await bot.sendMessage(
          msg.chat.id,
          "Подписка *Описание возможностей подписки*",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Подписаться",
                    callback_data: "start_subscription_process",
                  },
                ],
                [{ text: "Закрыть Меню", callback_data: "closeMenu" }],
              ],
            },
            reply_to_message_id: msg.message_id,
          }
        );
      } else if (msg.text == "/unsubscribe") {
        await bot.sendMessage(msg.chat.id, "Отмена подписки");
      } else if (msg.text == "/history") {
        await bot.sendMessage(msg.chat.id, "History");
      }
    } catch (error) {
      console.log(error);
    }
  });

  // Обрабатываем коллбеки на инлайн-клавиатуре
  bot.on("callback_query", async (ctx) => {
    try {
      switch (ctx.data) {
        case "closeMenu":
          await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);
          await bot.deleteMessage(
            ctx.message.reply_to_message.chat.id,
            ctx.message.reply_to_message.message_id
          );
          break;

        case "start_subscription_process":
          await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);

          await bot.sendInvoice(
            ctx.message.chat.id,
            "Подписка на магазин", // Заголовок счета
            "Оформление подписки, 100 рублей", // Описание
            "month_sub", // TODO: сделать уникальным. Payload - используем для того, чтобы отследить платеж, пользователю не отображается
            process.env.PAYMENT_TOKEN,
            "RUB",
            [
              {
                label: "Руб",
                amount: 10000,
              },
            ]
          );
          break;
      }
    } catch (error) {
      console.log(error);
    }
  });

  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await bot.answerPreCheckoutQuery(ctx.id, true);
    } catch (error) {
      console.log(error);
    }
  });

  //Обрабатываем удачный платеж от пользователя
  bot.on("successful_payment", async (ctx) => {
    try {
      // TODO: fix TypeError: Cannot read properties of undefined (reading 'chat')
      // await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);

      await bot.sendMessage(
        ctx.chat.id,
        `Оплата прошла успешно! Идентификатор платежа: ${ctx.successful_payment.provider_payment_charge_id}`
      );
    } catch (error) {
      console.log(error);
    }
  });

  bot.on("polling_error", (err) => console.log(err.data.error.message));
};

db.init().then(initApp);
