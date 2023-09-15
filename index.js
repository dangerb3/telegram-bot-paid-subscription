import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import CronJob from "cron";
import path from "path";
import express from "express";
// const CronJob = require("cron").CronJob;
// const db = require("./db/db.js");
import db from "./db/db.js";
import {
  timeout,
  getSubscriptionRemainingTime,
  createPDFReportAutoTable,
  parseTimestampToHumanDate,
} from "./utils/utils.js";
import axios from "axios";
import YooKassa from "yookassa";

import configManager from "./utils/configManager.js";

// process.env.NTBA_FIX_319 = 1;
// process.env.NTBA_FIX_350 = 0;

import dotenv from "dotenv";
dotenv.config();

const port = configManager.getConfig().PORT || 3000;
const expressApp = express();
const __dirname = path.resolve();

expressApp.use(express.static("static"));
expressApp.use(express.json());

const attemptCounts = Array.from(
  Array(Number(configManager.getConfig().ATTEMPT_WAIT_PAYMENT_COUNTS)).keys()
);

// const idempotencyKey = uuidv4();

const yooKassa = new YooKassa({
  shopId: configManager.getConfig().SHOP_ID,
  secretKey: configManager.getConfig().SHOP_SECRET_KEY,
});

const bot = new TelegramBot(configManager.getConfig().API_KEY_BOT, {
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

const checkIsAdmin = (username) => {
  return username === configManager.getConfig().ADMIN_TG_ACCOUNT_USERNAME;
};

const initBot = function () {
  // const commands = [
  //   { command: "subscribe", description: "Оформить подписку" },
  //   { command: "unsubscribe", description: "Прервать подписку" },
  //   { command: "history", description: "История списаний" },
  // ];

  const commands = [
    ["Оформить подписку"],
    ["Прервать подписку"],
    ["История списаний"],
  ];

  const adminCommands = [
    ["Текущая стоимость подписки"],
    ["Изменить стоимость подписки"],
    ["Экспортировать платежную историю всех пользователей"],
    ["Экспортировать статус подписок всех пользователей"],
    ["Экспортировать пользователей с неоплаченной подпиской"],
  ];

  // bot.setMyCommands(commands);

  bot.on("text", async (msg) => {
    try {
      const userId = msg.from.id;
      const username = msg.from.username;
      const userNickname = await db.getUserNickname(userId);

      if (msg.text === "/start") {
        await db.addNewUserChat(userId, msg.chat.id);

        if (checkIsAdmin(username)) {
          await bot.sendMessage(msg.chat.id, "Добро пожаловать, администратор");

          await bot.sendMessage(msg.chat.id, "Выберите действие", {
            reply_markup: {
              keyboard: adminCommands,
              force_reply: true,
              one_time_keyboard: true,
              resize_keyboard: true,
            },
          });
        } else {
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
            }
          } else {
            await bot.sendMessage(
              msg.chat.id,
              `Добро пожаловать! Выберите необходимое действие в меню`
            );
          }

          await bot.sendMessage(msg.chat.id, "Выберите действие", {
            reply_markup: {
              keyboard: commands,
              force_reply: true,
              one_time_keyboard: true,
              resize_keyboard: true,
            },
          });
        }
      }
      if (msg.text === "Оформить подписку") {
        await bot.deleteMessage(msg.chat.id, msg.message_id);

        const payment = await yooKassa.createPayment(
          {
            amount: {
              value: configManager.getConfig().SUB_PRICE,
              currency: "RUB",
            },
            payment_method_data: {
              type: "bank_card",
            },
            confirmation: {
              type: "redirect",
              return_url: `http://localhost/return_url`,
            },
            metadata: {
              user_id: msg.from.id,
              // time_sub:
            },
            capture: true,
            save_payment_method: true,
            description: `Оформление подписки, ${
              configManager.getConfig().SUB_PRICE
            } рублей`,
          },
          Math.floor(Math.random() * 100000000) + 1
        );

        await bot.sendMessage(
          msg.chat.id,
          `Стоимость подписки на ${
            configManager.getConfig().SUB_PERIOD
          } дней составляет ${
            configManager.getConfig().SUB_PRICE
          } рублей.\nОплата доступна по ссылке:\n ${payment.confirmationUrl}`
        );

        await bot.sendMessage(msg.chat.id, "Ожидание оплаты ...");

        let status;
        let savedPayment;

        for (const attempt of attemptCounts) {
          savedPayment = await yooKassa.getPayment(payment.id);

          if (savedPayment.isSucceeded) {
            status = "succeed";
            break;
          } else if (savedPayment.isWaitingForCapture) {
            status = "waitingForCapture";
            break;
          }

          console.count(
            `Waiting payment from user ${msg.from.id} (@${msg.from.username})`
          );

          await timeout(3000);
        }

        if (status === "succeed" || status === "waitingForCapture") {
          const isCardSaved = savedPayment.payment_method.saved;
          const getCardSavedStatus = isCardSaved
            ? "Автоплатежи активны"
            : "Автоплатежи не активны";

          if (status === "succeed")
            await bot.sendMessage(
              msg.chat.id,
              "Оплата прошла успешно.\n" + getCardSavedStatus
            );
          else if (status === "waitingForCapture")
            // TODO: cover case, set timeSub when payment succeed
            await bot.sendMessage(
              msg.chat.id,
              "Оплата прошла успешно.\n Транзакция ожидает подтверждения продавца.\n" +
                getCardSavedStatus
            );

          const date = new Date();
          const timeSub = date.setDate(date.getDate() + 30.44);

          const userId = savedPayment.metadata.user_id;
          const fullname = msg.from.first_name + (msg.from.last_name ?? "");
          const paymentId = savedPayment.id;
          const cardNumbers =
            savedPayment.payment_method.card.first6 +
            "," +
            savedPayment.payment_method.card.last4;

          const userNickname = await db.getUserNickname(userId);

          if (!userNickname)
            await db.addNewUser(userId, msg.from.username, fullname);

          await db.setSubscription(
            userId,
            timeSub,
            paymentId,
            cardNumbers,
            savedPayment.status,
            savedPayment.created_at
          );

          await db.updatePaymentHistory(userId);
        } else {
          const userNickname = await db.getUserNickname(userId);
          const fullname = msg.from.first_name + (msg.from.last_name ?? "");

          const date = new Date();
          const timeSub = date.setDate(date.getDate() + 30.44);

          const cardNumbers =
            (savedPayment?.payment_method?.card?.first6 || 0) +
            "," +
            (savedPayment?.payment_method?.card?.last4 || 0);

          if (!userNickname)
            await db.addNewUser(userId, msg.from.username, fullname);

          await db.setSubscription(
            userId,
            timeSub,
            savedPayment.id,
            cardNumbers,
            savedPayment.status,
            savedPayment.created_at
          );

          await db.updatePaymentHistory(userId);

          await bot.sendMessage(
            msg.chat.id,
            "Произошла ошибка при оплате. Обратитесь к администратору или попробуйте ещё раз.\nid платежа: " +
              savedPayment.id
          );
        }
      }
      if (msg.text === "Прервать подписку") {
        await bot.sendMessage(msg.chat.id, "Отмена подписки");
      }
      if (msg.text === "История списаний") {
        const historySource = await db.getPaymentsHistory(userId);

        // const history = historySource.map((item) => {
        //   Object.assign(item, { Окончание_подписки: item["time_sub"] });
        //   delete item["time_sub"];
        //   return item;
        // });

        const history = historySource.map((item) => ({
          ...item,
          time_sub: parseTimestampToHumanDate(item.time_sub),
          payment_date: parseTimestampToHumanDate(item.payment_date),
        }));

        console.log(history);

        const fileName = "report-" + userId + "-" + Date.now() + ".pdf";
        const location = "./output/";

        if (!fs.existsSync(location)) fs.mkdirSync(location);

        createPDFReportAutoTable(history, location + fileName);

        const fileOpts = {
          file: "Buffer",
          filename: fileName,
          contentType: "application/pdf",
        };

        const file = await fs.promises.readFile(location + fileName);

        await bot.sendDocument(msg.chat.id, file, fileOpts, {
          filename: fileName,
          contentType: "application/pdf",
        });

        await fs.promises.unlink(location + fileName);
      }

      if (
        msg.text === "Экспортировать платежную историю всех пользователей" &&
        checkIsAdmin(username)
      ) {
        const historySource = await db.getAllUsersPaymentsHistory();

        // const history = historySource.map((item) => {
        //   Object.assign(item, { Окончание_подписки: item["time_sub"] });
        //   delete item["time_sub"];
        //   return item;
        // });

        const history = historySource.map((item) => ({
          ...item,
          time_sub: parseTimestampToHumanDate(item.time_sub),
          payment_date: parseTimestampToHumanDate(item.payment_date),
        }));

        const fileName = "full-payments-report-" + Date.now() + ".pdf";
        const location = "./output/";

        if (!fs.existsSync(location)) fs.mkdirSync(location);

        createPDFReportAutoTable(history, location + fileName);

        const fileOpts = {
          file: "Buffer",
          filename: fileName,
          contentType: "application/pdf",
        };

        const file = await fs.promises.readFile(location + fileName);

        await bot.sendDocument(msg.chat.id, file, fileOpts, {
          filename: fileName,
          contentType: "application/pdf",
        });

        await fs.promises.unlink(location + fileName);
      }

      if (
        msg.text === "Экспортировать статус подписок всех пользователей" &&
        checkIsAdmin(username)
      ) {
        const historySource = await db.getAllUsersSubscriptionStatus();

        // const history = historySource.map((item) => {
        //   Object.assign(item, { Окончание_подписки: item["time_sub"] });
        //   delete item["time_sub"];
        //   return item;
        // });

        const history = historySource.map((item) => ({
          ...item,
          time_sub: parseTimestampToHumanDate(item.time_sub),
          payment_date: parseTimestampToHumanDate(item.payment_date),
        }));

        const fileName =
          "full-users-subscriptions-report-" + Date.now() + ".pdf";
        const location = "./output/";

        if (!fs.existsSync(location)) fs.mkdirSync(location);

        createPDFReportAutoTable(history, location + fileName);

        const fileOpts = {
          file: "Buffer",
          filename: fileName,
          contentType: "application/pdf",
        };

        const file = await fs.promises.readFile(location + fileName);

        await bot.sendDocument(msg.chat.id, file, fileOpts, {
          filename: fileName,
          contentType: "application/pdf",
        });

        await fs.promises.unlink(location + fileName);
      }

      if (msg.text === "Текущая стоимость подписки" && checkIsAdmin(username)) {
        await bot.sendMessage(msg.chat.id, configManager.getConfig().SUB_PRICE);
      }
      if (
        msg.text === "Изменить стоимость подписки" &&
        checkIsAdmin(username)
      ) {
        await bot.sendMessage(
          msg.chat.id,
          "Введите новую стоимость подписки, к примеру: 100.00"
        );

        await bot.once("text", async (reply) => {
          const userReply = reply.text;

          configManager.updateConfig({ SUB_PRICE: userReply });

          console.log("SUB_PRICE changed to ", userReply);

          await bot.sendMessage(
            msg.chat.id,
            `Стоимость подписки установлена: ${userReply}`
          );

          const usersChatsSource = await db.getAllUsersChats();

          const allChats = usersChatsSource.map((item) => item?.chat_id);
          for (const chat of allChats) {
            await bot.sendMessage(
              chat,
              `Внимание! Стоимость подписки изменена и равна: ${userReply} рублей`
            );
          }
        });
      }

      if (
        msg.text === "Экспортировать пользователей с неоплаченной подпиской" &&
        checkIsAdmin(username)
      ) {
        const historySource = await db.getAllUsersWithBadSubscriptionStatus();

        const history = historySource.map((item) => ({
          ...item,
          // time_sub: parseTimestampToHumanDate(item.time_sub),
          payment_date: parseTimestampToHumanDate(item.payment_date),
        }));

        const fileName =
          "bad-subscription-status-users-subscriptions-report-" +
          Date.now() +
          ".pdf";
        const location = "./output/";

        if (!fs.existsSync(location)) fs.mkdirSync(location);

        createPDFReportAutoTable(history, location + fileName);

        const fileOpts = {
          file: "Buffer",
          filename: fileName,
          contentType: "application/pdf",
        };

        const file = await fs.promises.readFile(location + fileName);

        await bot.sendDocument(msg.chat.id, file, fileOpts, {
          filename: fileName,
          contentType: "application/pdf",
        });

        await fs.promises.unlink(location + fileName);
      }
    } catch (error) {
      console.log(error);
    }
  });

  // Обрабатываем коллбеки на инлайн-клавиатуре
  // bot.on("callback_query", async (ctx) => {
  //   try {
  //     switch (ctx.data) {
  //       case "closeMenu":
  //         await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);
  //         await bot.deleteMessage(
  //           ctx.message.reply_to_message.chat.id,
  //           ctx.message.reply_to_message.message_id
  //         );
  //         break;

  //       case "start_subscription_process":
  //         await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);

  //         const payment = await yooKassa.createPayment(
  //           {
  //             amount: {
  //               value: "100.00",
  //               currency: "RUB",
  //             },
  //             payment_method_data: {
  //               type: "bank_card",
  //             },
  //             confirmation: {
  //               type: "redirect",
  //               return_url: `http://localhost/return_url`,
  //             },
  //             metadata: {
  //               user_id: ctx.from.id,
  //               // time_sub:
  //             },
  //             capture: true,
  //             save_payment_method: true,
  //             description: "Оформление подписки, 100 рублей",
  //           },
  //           Math.floor(Math.random() * 100000000) + 1
  //         );

  //         await bot.sendMessage(
  //           ctx.message.chat.id,
  //           "Доступна оплата по ссылке:\n" + payment.confirmationUrl
  //         );

  //         await bot.sendMessage(ctx.message.chat.id, "Ожидание оплаты ...");

  //         let status;
  //         let savedPayment;

  //         for (const attempt of attemptCounts) {
  //           const paymentInfo = await yooKassa.getPayment(payment.id);
  //           if (paymentInfo.isSucceeded) {
  //             status = "succeed";
  //             savedPayment = paymentInfo;
  //             break;
  //           } else if (paymentInfo.isWaitingForCapture) {
  //             status = "waitingForCapture";
  //             savedPayment = paymentInfo;
  //             break;
  //           }
  //           console.log("attempt");
  //           await timeout(3000);
  //         }

  //         const isCardSaved = savedPayment.payment_method.saved;
  //         const getCardSavedStatus = isCardSaved
  //           ? "Автоплатежи активны"
  //           : "Автоплатежи не активны";

  //         if (status === "succeed" || status === "waitingForCapture") {
  //           if (status === "succeed")
  //             await bot.sendMessage(
  //               ctx.message.chat.id,
  //               "Оплата прошла успешно.\n" + getCardSavedStatus
  //             );
  //           else if (status === "waitingForCapture")
  //             // TODO: cover case, set timeSub when payment succeed
  //             await bot.sendMessage(
  //               ctx.message.chat.id,
  //               "Оплата прошла успешно.\n Транзакция ожидает подтверждения продавца.\n" +
  //                 getCardSavedStatus
  //             );

  //           const date = new Date();
  //           const timeSub = date.setDate(date.getDate() + 30.44);

  //           const userId = savedPayment.metadata.user_id;
  //           const fullname = ctx.from.first_name + (ctx.from.last_name ?? "");
  //           const paymentId = savedPayment.id;
  //           const cardNumbers =
  //             savedPayment.payment_method.card.first6 +
  //             "," +
  //             savedPayment.payment_method.card.last4;

  //           const userNickname = await db.getUserNickname(userId);

  //           if (!userNickname)
  //             await db.addNewUser(userId, ctx.from.username, fullname);

  //           await db.setSubscription(
  //             userId,
  //             timeSub,
  //             paymentId,
  //             cardNumbers,
  //             savedPayment.status,
  //             savedPayment.created_at
  //           );

  //           await db.updatePaymentHistory(userId);
  //         } else
  //           await bot.sendMessage(
  //             ctx.message.chat.id,
  //             "Произошла ошибка при оплате. Обратитесь к администратору.\n id платежа: " +
  //               payment.id
  //           );

  //         // console.log(savedPayment);

  //         // await bot.sendInvoice(
  //         //   ctx.message.chat.id,
  //         //   "Подписка на магазин", // Заголовок счета
  //         //   "Оформление подписки, 100 рублей", // Описание
  //         //   "month_sub", // TODO: сделать уникальным. Payload - используем для того, чтобы отследить платеж, пользователю не отображается
  //         //   configManager.getConfig().PAYMENT_TOKEN,
  //         //   "RUB",
  //         //   [
  //         //     {
  //         //       label: "Руб",
  //         //       amount: 10000,
  //         //     },
  //         //   ]
  //         // );
  //         break;
  //     }
  //   } catch (error) {
  //     console.log(error);
  //   }
  // });

  // bot.on("pre_checkout_query", async (ctx) => {
  //   try {
  //     await bot.answerPreCheckoutQuery(ctx.id, true);
  //   } catch (error) {
  //     console.log(error);
  //   }
  // });

  // //Обрабатываем удачный платеж от пользователя
  // bot.on("successful_payment", async (ctx) => {
  //   try {
  //     // TODO: fix TypeError: Cannot read properties of undefined (reading 'chat')
  //     // await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);
  //     if (ctx.successful_payment.invoice_payload === "month_sub") {
  //       // const timeSub = Date.now() + daysToSeconds(30);
  //       const date = new Date();
  //       const timeSub = date.setDate(date.getDate() + 30.44);

  //       const userId = ctx.from.id;
  //       const paymentId = ctx.successful_payment.provider_payment_charge_id;

  //       const userNickname = await db.getUserNickname(userId);

  //       if (!userNickname)
  //         await db.addNewUser(
  //           userId,
  //           ctx.from.username,
  //           ctx.from.first_name + (ctx.from.last_name ?? "")
  //         );

  //       await db.setSubscription(userId, timeSub, paymentId);

  //       console.log(ctx);

  //       await bot.sendMessage(
  //         ctx.chat.id,
  //         `Оплата прошла успешно! Идентификатор платежа: ${paymentId}`
  //       );
  //     }
  //   } catch (error) {
  //     console.log(error);
  //   }
  // });

  bot.on("polling_error", (err) => console.log(err.data.error.message));
};

db.init().then(initApp);
