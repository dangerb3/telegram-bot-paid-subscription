import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import CronJob from "cron";
import path from "path";
import express from "express";
// const CronJob = require("cron").CronJob;
// const db = require("./db/db.js");
import db from "./db/db.js";
import { timeout, getSubscriptionRemainingTime } from "./utils/utils.js";
import axios from "axios";
import YooKassa from "yookassa";

import dotenv from "dotenv";
dotenv.config();

const port = process.env.PORT || 3000;
const expressApp = express();
const __dirname = path.resolve();

expressApp.use(express.static("static"));
expressApp.use(express.json());

const attemptCounts = Array.from(Array(300).keys());

// const idempotencyKey = uuidv4();

const yooKassa = new YooKassa({
  shopId: process.env.SHOP_ID,
  secretKey: process.env.SHOP_SECRET_KEY,
});

const bot = new TelegramBot(process.env.API_KEY_BOT, {
  polling: true,
});

expressApp.get("/", (req, res) => {
  res.sendFile(path.join(__dirname + "/public/index.html"));
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
        await db.updatePaymentHistory(
          1
          // ctx.from.username,
          // fullname,
          // timeSub,
          // paymentId,
          // cardNumbers,
          // savedPayment.status
        );
        const userId = msg.from.id;
        const userNickname = await db.getUserNickname(userId);

        if (userNickname) {
          const timeSub = await db.getTimeSubscription(userId);

          const remainedSubTime = getSubscriptionRemainingTime(timeSub);

          if (remainedSubTime) {
            await bot.sendMessage(
              msg.chat.id,
              `Добро пожаловать, ${userNickname}!\nСтатус Вашей подписки: ${remainedSubTime}`
            );

            await bot.sendMessage(
              msg.chat.id,
              `Выберите необходимое действие в меню`
            );
          } else
            await bot.sendMessage(
              msg.chat.id,
              `Добро пожаловать! Выберите необходимое действие в меню`
            );
        }

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

          const payment = await yooKassa.createPayment(
            {
              amount: {
                value: "100.00",
                currency: "RUB",
              },
              payment_method_data: {
                type: "bank_card",
              },
              confirmation: {
                type: "redirect",
                return_url: `http://localhost/return_url`,
                // return_url: "https://www.merchant-website.com/return_url"
              },
              metadata: {
                user_id: ctx.from.id,
                // time_sub:
              },
              capture: true,
              save_payment_method: true,
              description: "Оформление подписки, 100 рублей",
            },
            Math.floor(Math.random() * 100000000) + 1
          );

          await bot.sendMessage(
            ctx.message.chat.id,
            "Доступна оплата по ссылке:\n" + payment.confirmationUrl
          );

          await bot.sendMessage(ctx.message.chat.id, "Ожидание оплаты ...");

          let status;
          let savedPayment;

          for (const attempt of attemptCounts) {
            const paymentInfo = await yooKassa.getPayment(payment.id);
            if (paymentInfo.isSucceeded) {
              status = "succeed";
              savedPayment = paymentInfo;
              break;
            } else if (paymentInfo.isWaitingForCapture) {
              status = "waitingForCapture";
              savedPayment = paymentInfo;
              break;
            }
            console.log("attempt");
            await timeout(3000);
          }

          const isCardSaved = savedPayment.payment_method.saved;
          const getCardSavedStatus = isCardSaved
            ? "Автоплатежи активны"
            : "Автоплатежи не активны";

          if (status === "succeed" || status === "waitingForCapture") {
            if (status === "succeed")
              await bot.sendMessage(
                ctx.message.chat.id,
                "Оплата прошла успешно.\n" + getCardSavedStatus
              );
            else if (status === "waitingForCapture")
              // TODO: cover case, set timeSub when payment succeed
              await bot.sendMessage(
                ctx.message.chat.id,
                "Оплата прошла успешно.\n Транзакция ожидает подтверждения продавца.\n" +
                  getCardSavedStatus
              );

            const date = new Date();
            const timeSub = date.setDate(date.getDate() + 30.44);

            const userId = savedPayment.metadata.user_id;
            const fullname = ctx.from.first_name + (ctx.from.last_name ?? "");
            const paymentId = savedPayment.id;
            const cardNumbers =
              savedPayment.payment_method.card.first6 +
              "," +
              savedPayment.payment_method.card.last4;

            const userNickname = await db.getUserNickname(userId);

            if (!userNickname)
              await db.addNewUser(userId, ctx.from.username, fullname);

            await db.setSubscription(
              userId,
              timeSub,
              paymentId,
              cardNumbers,
              savedPayment.status,
              savedPayment.created_at
            );

            await db.updatePaymentHistory(
              userId
              // ctx.from.username,
              // fullname,
              // timeSub,
              // paymentId,
              // cardNumbers,
              // savedPayment.status
            );
          } else
            await bot.sendMessage(
              ctx.message.chat.id,
              "Произошла ошибка при оплате. Обратитесь к администратору.\n id платежа: " +
                payment.id
            );

          // console.log(savedPayment);

          // await bot.sendInvoice(
          //   ctx.message.chat.id,
          //   "Подписка на магазин", // Заголовок счета
          //   "Оформление подписки, 100 рублей", // Описание
          //   "month_sub", // TODO: сделать уникальным. Payload - используем для того, чтобы отследить платеж, пользователю не отображается
          //   process.env.PAYMENT_TOKEN,
          //   "RUB",
          //   [
          //     {
          //       label: "Руб",
          //       amount: 10000,
          //     },
          //   ]
          // );
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
      if (ctx.successful_payment.invoice_payload === "month_sub") {
        // const timeSub = Date.now() + daysToSeconds(30);
        const date = new Date();
        const timeSub = date.setDate(date.getDate() + 30.44);

        const userId = ctx.from.id;
        const paymentId = ctx.successful_payment.provider_payment_charge_id;

        const userNickname = await db.getUserNickname(userId);

        if (!userNickname)
          await db.addNewUser(
            userId,
            ctx.from.username,
            ctx.from.first_name + (ctx.from.last_name ?? "")
          );

        await db.setSubscription(userId, timeSub, paymentId);

        console.log(ctx);

        await bot.sendMessage(
          ctx.chat.id,
          `Оплата прошла успешно! Идентификатор платежа: ${paymentId}`
        );
      }
    } catch (error) {
      console.log(error);
    }
  });

  bot.on("polling_error", (err) => console.log(err.data.error.message));
};

db.init().then(initApp);
