import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import { CronJob } from "cron";
import path from "path";
import express from "express";
import db from "./db/db.js";
import {
  timeout,
  getSubscriptionRemainingTime,
  createPDFReportAutoTable,
  parseTimestampToHumanDate,
  getSubscriptionStatus,
} from "./utils/utils.js";
import YooKassa from "yookassa";

import configManager from "./utils/configManager.js";

// process.env.NTBA_FIX_319 = 1; process.env.NTBA_FIX_350 = 0;

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

const job = new CronJob(
  // '* 0 * * * *', every hour
  "* * * * *", // every minute
  async () => {
    try {
      console.log("Cron Task executing ...");

      const users = await db.getAllUsersSubscriptionStatus();

      users.forEach(async (user) => {
        if (
          !getSubscriptionStatus(user.time_sub) &&
          user.payment_status !== "cancelledByUser" &&
          !user.payment_status.includes("error: ")
        ) {
          const targetChatId = await db.getUserChatByUserId(user.user_id);

          try {
            console.log(
              "Autopayment started for: @" +
                user.nickname +
                " time_sub: " +
                user.time_sub
            );

            const payment = await yooKassa.createPayment(
              {
                amount: {
                  value: configManager.getConfig().SUB_PRICE,
                  currency: "RUB",
                },
                metadata: {
                  user_id: user.user_id,
                  // time_sub:
                },
                payment_method_id: user.payment_code, // TODO: make to payment_method.id
                capture: true,
                description: `Автоплатеж по подписке, ${
                  configManager.getConfig().SUB_PRICE
                } рублей`,
              },
              Math.floor(Math.random() * 100000000) + 1
            );

            await bot.sendMessage(
              targetChatId,
              `Автоплатеж по подписке инициирован (${
                configManager.getConfig().SUB_PRICE
              }) рублей`
            );
            let status;
            let savedPayment;

            console.log(
              `Autopayment attempt ${user.user_id} (@${user.nickname})`
            );

            savedPayment = await yooKassa.getPayment(payment.id);

            if (savedPayment.isSucceeded) {
              status = "succeed";
            } else if (savedPayment.isWaitingForCapture) {
              status = "waitingForCapture";
            }

            if (status === "succeed" || status === "waitingForCapture") {
              if (status === "succeed")
                await bot.sendMessage(
                  targetChatId,
                  "Автоплатеж по подписке прошел успешно. Спасибо!"
                );
              else if (status === "waitingForCapture")
                // TODO: cover case, set timeSub when payment succeed
                await bot.sendMessage(
                  targetChatId,
                  "Автоплатеж по подписке прошел успешно.\n Транзакция ожидает подтверждения продавца."
                );
              const date = new Date();
              const timeSub = date.setDate(
                date.getDate() + configManager.getConfig().SUB_PERIOD_DAYS
              );
              // const userId = savedPayment.metadata.user_id; const fullname =
              // msg.from.first_name + (msg.from.last_name ?? "");
              const paymentId = savedPayment.id;
              const cardNumbers =
                savedPayment.payment_method.card.first6 +
                "," +
                savedPayment.payment_method.card.last4;
              const userNickname = await db.getUserNickname(user.user_id);

              await db.setSubscription(
                user.user_id,
                timeSub,
                paymentId,
                cardNumbers,
                savedPayment.status,
                savedPayment.created_at
              );
              await db.updatePaymentHistory(user.user_id);
            } else {
              // const userNickname = await db.getUserNickname(user.user_id); const fullname =
              // msg.from.first_name + (msg.from.last_name ?? "");
              const date = new Date();
              const timeSub = date.setDate(
                date.getDate() + configManager.getConfig().SUB_PERIOD_DAYS
              );
              const cardNumbers =
                (savedPayment?.payment_method?.card?.first6 || 0) +
                "," +
                (savedPayment?.payment_method?.card?.last4 || 0);

              await db.setSubscription(
                user.user_id,
                timeSub,
                savedPayment.id,
                cardNumbers,
                savedPayment.status,
                savedPayment.created_at
              );
              await db.updatePaymentHistory(user.user_id);
              await bot.sendMessage(
                targetChatId,
                "Произошла ошибка при оплате месячной подписки. Обратитесь к администратору или попробуйте ещё раз.\nid платежа: " +
                  savedPayment.id
              );
            }
          } catch (e) {
            console.log("Error: " + e);

            await bot.sendMessage(
              targetChatId,
              "Произошла ошибка при оплате месячной подписки. Обратитесь к администратору."
            );

            await db.setSubscription(
              user.user_id,
              0,
              0,
              user.card_numbers,
              "error: " + e,
              new Date()
            );
            await db.updatePaymentHistory(user.user_id);
          }
        }
      });
    } catch (e) {
      console.log("Error: " + e);
    }
  }
);
job.start();

console.log("Bot server is working ...");

const initApp = function () {
  initBot();
};

const checkIsAdmin = (username) => {
  return configManager
    .getConfig()
    .ADMIN_TG_ACCOUNT_USERNAMES.split(",")
    .includes(username);
};

const initBot = function () {
  const commands = [
    ["Оформить подписку"],
    ["Прервать подписку"],
    ["История списаний"],
  ];

  const adminCommands = [
    ["Текущая стоимость подписки"],
    ["Текущий период оплаты"],
    ["Изменить стоимость подписки"],
    ["Изменить период оплаты"],
    ["Экспортировать платежную историю всех пользователей"],
    ["Экспортировать статус подписок всех пользователей"],
    ["Экспортировать пользователей с неоплаченной подпиской"],
  ];

  bot.on("text", async (msg) => {
    try {
      const userId = msg.from.id;
      const username = msg.from.username;
      const userNickname = await db.getUserNickname(userId);

      if (msg.text === "/start") {
        await db.addNewUserChat(userId, username, msg.chat.id);

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
              return_url: configManager.getConfig().BOT_LINK,
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
          console.count(
            `Waiting payment from user ${msg.from.id} (@${msg.from.username})`
          );

          savedPayment = await yooKassa.getPayment(payment.id);

          if (savedPayment.isSucceeded) {
            status = "succeed";
            break;
          } else if (savedPayment.isWaitingForCapture) {
            status = "waitingForCapture";
            break;
          }

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
          const timeSub = date.setDate(
            date.getDate() + configManager.getConfig().SUB_PERIOD_DAYS
          );

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
          const timeSub = date.setDate(
            date.getDate() + configManager.getConfig().SUB_PERIOD_DAYS
          );

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
            "Произошла ошибка при оплате. Обратитесь к администратору или попробуйте ещё раз." +
              "\nid платежа: " +
              savedPayment.id
          );
        }
      }
      if (msg.text === "Прервать подписку") {
        await db.setSubscription(
          userId,
          0,
          0,
          0,
          "cancelledByUser",
          parseTimestampToHumanDate(new Date())
        );
        await bot.sendMessage(msg.chat.id, "Подписка успешно отменена");

        const chats = await db.getAllUsersChats();
        const adminChats = chats.filter((i) => checkIsAdmin(i.nickname));

        for (let chat of adminChats) {
          await bot.sendMessage(
            chat.chat_id,
            `Пользователь @${username} (id ${userId}) отменил подписку`
          );
        }
      }
      if (msg.text === "История списаний") {
        const historySource = await db.getPaymentsHistory(userId);

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

      // Admin commands
      if (
        msg.text === "Экспортировать платежную историю всех пользователей" &&
        checkIsAdmin(username)
      ) {
        const historySource = await db.getAllUsersPaymentsHistory();

        // const history = historySource.map((item) => {   Object.assign(item, {
        // Окончание_подписки: item["time_sub"] });   delete item["time_sub"];   return
        // item; });

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

        // const history = historySource.map((item) => {   Object.assign(item, {
        // Окончание_подписки: item["time_sub"] });   delete item["time_sub"];   return
        // item; });

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
      if (msg.text === "Текущий период оплаты" && checkIsAdmin(username)) {
        await bot.sendMessage(
          msg.chat.id,
          configManager.getConfig().SUB_PERIOD_DAYS
        );
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

          console.log(`ADMIN (${username}): SUB_PRICE changed to ${userReply}`);

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

      if (msg.text === "Изменить период оплаты" && checkIsAdmin(username)) {
        await bot.sendMessage(
          msg.chat.id,
          "Введите новое значение периода оплаты, к примеру: 30.44"
        );

        await bot.once("text", async (reply) => {
          const userReply = reply.text;

          configManager.updateConfig({ SUB_PERIOD_DAYS: userReply });

          console.log(
            `ADMIN (${username}): SUB_PERIOD_DAYS changed to ${userReply}`
          );

          await bot.sendMessage(
            msg.chat.id,
            `Период оплаты изменен: ${userReply} дней`
          );
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
          // payment_date: parseTimestampToHumanDate(item.payment_date),
          payment_date: item.payment_date,
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

  bot.on("polling_error", (err) => console.log(err.data.error.message));
};

db.init().then(initApp);
