import TelegramBot from "node-telegram-bot-api";
import { CronJob } from "cron";
import path from "path";
import express from "express";
import db from "./db/db.js";
import {
  timeout,
  getSubscriptionRemainingTime,
  parseTimestampToHumanDate,
  getSubscriptionStatus,
  sendHistoryFile,
  parseTableHistory,
  createUserResponseManaged,
} from "./utils/utils.js";
import YooKassa from "yookassa";

import translitRusEng from "translit-rus-eng";

import configManager from "./utils/configManager.js";

import { ReplyManager } from "node-telegram-operation-manager";

import logToFile from "log-to-file";

var log = console.log;

console.log = function () {
  log.apply(
    console,
    [parseTimestampToHumanDate(Date.now())].concat(arguments[0]),
    logToFile(arguments[0])
  );
};

// process.env.NTBA_FIX_319 = 1; process.env.NTBA_FIX_350 = 0;

import dotenv from "dotenv";
dotenv.config();

const expressApp = express();
const __dirname = path.resolve();

expressApp.use(express.static("static"));
expressApp.use(express.json());

const attemptCounts = Array.from(
  Array(Number(configManager.getConfig().ATTEMPT_WAIT_PAYMENT_COUNTS)).keys()
);

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
  "0 * * * *", // every hour
  // "* * * * *", // every minute
  async () => {
    try {
      console.log("Cron Task executing ...");

      const users = await db.getAllUsersSubscriptionStatus();

      users.forEach(async (user) => {
        if (
          !getSubscriptionStatus(user.time_sub) &&
          user.payment_status === "succeeded" &&
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

            const phoneNumber = await db.getInfoPhone(user.user_id);

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
                receipt: {
                  customer: {
                    phone: phoneNumber,
                  },
                  items: [
                    {
                      description: `Автоплатеж по подписке, ${
                        configManager.getConfig().SUB_PRICE
                      } рублей`,
                      quantity: "1.00",
                      amount: {
                        value: configManager.getConfig().SUB_PRICE,
                        currency: "RUB",
                      },
                      vat_code: "1",
                      payment_mode: "full_payment",
                      payment_subject: "service",
                    },
                  ],
                },
                payment_method_id: user.payment_method,
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
              } рублей)`
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
                date.getDate() +
                  Number(configManager.getConfig().SUB_PERIOD_DAYS)
              );

              const paymentId = savedPayment.id;
              const paymentMethod = savedPayment.payment_method.id;
              const cardNumbers =
                savedPayment.payment_method.card.first6 +
                "," +
                savedPayment.payment_method.card.last4;

              await db.setSubscription(
                user.user_id,
                timeSub,
                paymentId,
                paymentMethod,
                cardNumbers,
                savedPayment.status,
                savedPayment.created_at,
                savedPayment.amount.value + savedPayment.amount.currency
              );
              await db.updatePaymentHistory(user.user_id);
            } else {
              // const userNickname = await db.getUserNickname(user.user_id); const fullname =
              // msg.from.first_name + (msg.from.last_name ?? "");
              const date = new Date();
              const timeSub = date.setDate(
                date.getDate() +
                  Number(configManager.getConfig().SUB_PERIOD_DAYS)
              );
              const cardNumbers =
                (savedPayment?.payment_method?.card?.first6 || 0) +
                "," +
                (savedPayment?.payment_method?.card?.last4 || 0);

              await db.setSubscription(
                user.user_id,
                timeSub,
                savedPayment.id,
                savedPayment.payment_method.id,
                cardNumbers,
                savedPayment.status,
                savedPayment.created_at,
                savedPayment.amount.value + savedPayment.amount.currency
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
              "Произошла ошибка при оплате месячной подписки. Обратитесь к администратору"
            );

            await db.setSubscription(
              user.user_id,
              0,
              savedPayment.id,
              user.payment_method,
              user.card_numbers,
              "error: " + e,
              new Date().toISOString(),
              savedPayment.amount.value + savedPayment.amount.currency
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

const reply = new ReplyManager();

const initBot = function () {
  const commands = [["Подписка"], ["Прервать подписку"], ["История списаний"]];

  const adminCommands = [
    ["Текущая стоимость подписки"],
    ["Текущий период оплаты"],
    ["Изменить стоимость подписки"],
    ["Изменить период оплаты"],
    ["Экспортировать платежную историю всех пользователей"],
    ["Экспортировать статус подписок всех пользователей"],
    ["Экспортировать пользователей с неоплаченной подпиской"],
  ];

  bot.on("message", (msg) => {
    if (reply.expects(msg.chat.id)) {
      let { text, entities } = msg;
      reply.execute(msg.chat.id, { text, entities });
    }
  });

  bot.on("text", async (msg) => {
    try {
      const userId = msg.from.id;
      const username = msg.from.username;
      const userNickname = await db.getUserNickname(userId);

      if (msg.text === "/start") {
        await db.addNewUserChat(userId, username, msg.chat.id);

        const isAdmin = checkIsAdmin(username);

        if (isAdmin) {
          await bot.sendMessage(msg.chat.id, "Добро пожаловать, администратор");

          await bot.sendMessage(msg.chat.id, "Выберите действие", {
            reply_markup: {
              keyboard: adminCommands,
              force_reply: true,
              // one_time_keyboard: true,
              resize_keyboard: true,
            },
          });
        } else if (userNickname) {
          const timeSub = await db.getTimeSubscription(userId);
          const remainedSubTime = getSubscriptionRemainingTime(timeSub);

          // if (remainedSubTime) {
          await bot.sendMessage(
            msg.chat.id,
            `Добро пожаловать, ${userNickname}!\nСтатус Вашей подписки: ${
              remainedSubTime || "неактивен"
            }`
          );

          await bot.sendMessage(
            msg.chat.id,
            `Спасибо, что выбираете нас! Если необходимо проверить историю списаний, нажмите кнопку «История списаний» внизу бота`
          );

          // await bot.sendMessage(
          //   msg.chat.id,
          //   `Выберите необходимое действие в меню`
          // );
          // }
        } else {
          await bot.sendMessage(
            msg.chat.id,
            `Добро пожаловать! Данный <b>бот</b> служит для оформления ежемесячной подписки на занятия португальским языком. Подписку в любой момент можно отменить. Стоимость подписки ${
              configManager.getConfig().SUB_PRICE
            } рублей / месяц.`,
            { parse_mode: "HTML" }
          );

          bot.sendMessage(
            msg.chat.id,
            `Введите, пожалуйста, свой телефон, который вы будете использовать для доступа к материалам.`,
            {
              reply_markup: {
                remove_keyboard: true,
              },
            }
          );

          const phoneNumber = await createUserResponseManaged(
            bot,
            msg.chat.id,
            reply,
            /^[^\p{L}]+$/,
            "Номер телефона успешно сохранен",
            "Введите номер телефона корректно"
          );

          await db.prepareUser(msg.from.id, msg.from.username);
          await db.addInfoPhone(msg.from.id, phoneNumber);
        }

        if (!isAdmin)
          await bot.sendMessage(msg.chat.id, "Выберите действие ниже:", {
            reply_markup: {
              keyboard: commands,
              force_reply: true,
              // one_time_keyboard: true,
              resize_keyboard: true,
            },
          });
      }
      if (msg.text === "Подписка") {
        const timeSub = await db.getTimeSubscription(userId);

        const subscriptionStatus = timeSub
          ? (await db.getSubscriptionStatus(msg.from.id)).payment_status
          : undefined;

        if (subscriptionStatus === "succeeded") {
          const remainedSubTime = getSubscriptionRemainingTime(timeSub);

          await bot.sendMessage(
            msg.chat.id,
            `\nСтатус Вашей подписки: ${remainedSubTime || "неактивен"}`
          );
        } else {
          const phoneNumber = await db.getInfoPhone(msg.from.id);

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
              receipt: {
                customer: {
                  phone: phoneNumber,
                },
                items: [
                  {
                    description: `Оформление подписки, ${
                      configManager.getConfig().SUB_PRICE
                    } рублей`,
                    quantity: "1.00",
                    amount: {
                      value: configManager.getConfig().SUB_PRICE,
                      currency: "RUB",
                    },
                    vat_code: "1",
                    payment_mode: "full_payment",
                    payment_subject: "service",
                  },
                ],
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
              configManager.getConfig().SUB_PERIOD_DAYS
            } дней составляет ${
              configManager.getConfig().SUB_PRICE
            } рублей.\nОплата доступна по ссылке:\n ${payment.confirmationUrl}`,
            {
              reply_markup: {
                remove_keyboard: true,
              },
            }
          );

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

            if (status === "succeed") {
              await bot.sendMessage(
                msg.chat.id,
                "Оплата прошла успешно.\n" + getCardSavedStatus,
                {
                  reply_markup: {
                    keyboard: commands,
                    force_reply: true,
                    // one_time_keyboard: true,
                    resize_keyboard: true,
                  },
                }
              );

              await bot.sendMessage(
                msg.chat.id,
                "Введите, пожалуйста, своё ФИО (через пробел)"
              );

              const fullname = await createUserResponseManaged(
                bot,
                msg.chat.id,
                reply,
                /[\S\s]+[\S]+/,
                "Данные сохранены",
                "Неверный формат"
              );

              await bot.sendMessage(
                msg.chat.id,
                `Введите, пожалуйста, свой email`
              );

              const email = await createUserResponseManaged(
                bot,
                msg.chat.id,
                reply,
                /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
                "Данные сохранены",
                "Неверный формат"
              );

              await db.addInfoFullnameAndEmail(msg.from.id, fullname, email);
            } else if (status === "waitingForCapture")
              // TODO: cover case, set timeSub when payment succeed
              await bot.sendMessage(
                msg.chat.id,
                "Оплата прошла успешно.\n Транзакция ожидает подтверждения продавца.\n" +
                  getCardSavedStatus,
                {
                  reply_markup: {
                    keyboard: commands,
                    force_reply: true,
                    // one_time_keyboard: true,
                    resize_keyboard: true,
                  },
                }
              );

            const date = new Date();
            const timeSub = date.setDate(
              date.getDate() + Number(configManager.getConfig().SUB_PERIOD_DAYS)
            );

            const userId = savedPayment.metadata.user_id;
            const fullname = msg.from.first_name + (msg.from.last_name ?? "");
            const paymentId = savedPayment.id;
            const paymentMethod = savedPayment.payment_method.id;
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
              paymentMethod,
              cardNumbers,
              savedPayment.status,
              savedPayment.created_at,
              savedPayment.amount.value + savedPayment.amount.currency
            );

            await db.updatePaymentHistory(userId);
          } else {
            const userNickname = await db.getUserNickname(userId);
            const fullname = msg.from.first_name + (msg.from.last_name ?? "");

            const date = new Date();
            const timeSub = date.setDate(
              date.getDate() + Number(configManager.getConfig().SUB_PERIOD_DAYS)
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
              savedPayment.payment_method.id,
              cardNumbers,
              savedPayment.status,
              savedPayment.created_at,
              savedPayment.amount.value + savedPayment.amount.currency
            );

            await db.updatePaymentHistory(userId);

            await bot.sendMessage(
              msg.chat.id,
              "Произошла ошибка при оплате. Обратитесь к администратору или попробуйте ещё раз." +
                "\nid платежа: " +
                savedPayment.id,
              {
                reply_markup: {
                  keyboard: commands,
                  force_reply: true,
                  // one_time_keyboard: true,
                  resize_keyboard: true,
                },
              }
            );
          }
        }
      }
      if (msg.text === "Прервать подписку") {
        const subscriptionStatusSource = await db.getSubscriptionStatus(
          msg.from.id
        );

        const subscriptionStatus = subscriptionStatusSource?.payment_status;
        const subscriptionDate = subscriptionStatusSource?.payment_date;

        if (subscriptionStatus === "succeeded") {
          await db.setSubscription(
            userId,
            0,
            0,
            0,
            0,
            "cancelledByUser",
            new Date().toISOString(),
            0
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
        } else {
          if (subscriptionStatus === "cancelledByUser")
            await bot.sendMessage(
              msg.chat.id,
              `Невозможно отменить подписку, подписка была отменена: ${parseTimestampToHumanDate(
                subscriptionDate
              )}`
            );
          else
            await bot.sendMessage(
              msg.chat.id,
              `Невозможно отменить подписку, подписка не активна`
            );
        }
      }
      if (msg.text === "История списаний") {
        const historySource = await db.getPaymentsHistory(userId);

        await sendHistoryFile(
          [
            {
              ...historySource[0],
              info_fullname: translitRusEng(historySource[0]?.info_fullname),
            },
          ],
          configManager.getConfig().OUTPUT_FOLDER,
          "report-" + userId + "-" + Date.now() + ".pdf",
          bot,
          msg.chat.id,
          "История списаний пуста"
        );
      }

      // Admin commands
      if (
        msg.text === "Экспортировать платежную историю всех пользователей" &&
        checkIsAdmin(username)
      ) {
        const historySource = await db.getAllUsersPaymentsHistory();

        const historySourceWithFullname =
          historySource.length === 0
            ? []
            : [
                {
                  ...historySource[0],
                  info_fullname: translitRusEng(
                    historySource[0]?.info_fullname
                  ),
                },
              ];

        await sendHistoryFile(
          historySourceWithFullname,
          configManager.getConfig().OUTPUT_FOLDER,
          "full-payments-report-" + Date.now() + ".pdf",
          bot,
          msg.chat.id,
          "Платежная история пуста"
        );
      }

      if (
        msg.text === "Экспортировать статус подписок всех пользователей" &&
        checkIsAdmin(username)
      ) {
        const historySource = await db.getAllUsersSubscriptionStatus();

        const historySourceWithFullname =
          historySource.length === 0
            ? []
            : [
                {
                  ...historySource[0],
                  info_fullname: translitRusEng(
                    historySource[0]?.info_fullname
                  ),
                },
              ];

        await sendHistoryFile(
          historySourceWithFullname,
          configManager.getConfig().OUTPUT_FOLDER,
          "full-users-subscriptions-report-" + Date.now() + ".pdf",
          bot,
          msg.chat.id,
          "Статус подписок пуст"
        );
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

        const historySourceWithFullname =
          historySource.length === 0
            ? []
            : [
                {
                  ...historySource[0],
                  info_fullname: translitRusEng(
                    historySource[0]?.info_fullname
                  ),
                },
              ];

        await sendHistoryFile(
          historySourceWithFullname,
          configManager.getConfig().OUTPUT_FOLDER,
          "bad-subscription-status-users-subscriptions-report-" +
            Date.now() +
            ".pdf",
          bot,
          msg.chat.id,
          "Список пуст"
        );
      }
    } catch (error) {
      console.log(error);
    }
  });

  bot.on("polling_error", (err) =>
    console.error("polling_error: " + err?.data?.error?.message)
  );
};

db.init().then(initApp);
