const { Telegraf } = require("telegraf");
require("dotenv").config();

const bot = new Telegraf(process.env.API_KEY_BOT); //сюда помещается токен, который дал botFather

const getInvoice = (id) => {
  const invoice = {
    chat_id: id, // Уникальный идентификатор целевого чата или имя пользователя целевого канала
    provider_token: process.env.PAYMENT_TOKEN, // токен выданный через бот @SberbankPaymentBot
    start_parameter: "get_access", //Уникальный параметр глубинных ссылок. Если оставить поле пустым, переадресованные копии отправленного сообщения будут иметь кнопку «Оплатить», позволяющую нескольким пользователям производить оплату непосредственно из пересылаемого сообщения, используя один и тот же счет. Если не пусто, перенаправленные копии отправленного сообщения будут иметь кнопку URL с глубокой ссылкой на бота (вместо кнопки оплаты) со значением, используемым в качестве начального параметра.
    title: "InvoiceTitle", // Название продукта, 1-32 символа
    description: "InvoiceDescription", // Описание продукта, 1-255 знаков
    currency: "RUB", // Трехбуквенный код валюты ISO 4217
    prices: [{ label: "Invoice Title", amount: 100 * 100 }], // Разбивка цен, сериализованный список компонентов в формате JSON 100 копеек * 100 = 100 рублей
    payload: {
      // Полезные данные счета-фактуры, определенные ботом, 1–128 байт. Это не будет отображаться пользователю, используйте его для своих внутренних процессов.
      unique_id: `${id}_${Number(new Date())}`,
      provider_token: process.env.PAYMENT_TOKEN,
    },
  };

  return invoice;
};

bot.use(Telegraf.log());

bot.hears("pay", (ctx) => {
  // это обработчик конкретного текста, данном случае это - "pay"
  return ctx.replyWithInvoice(getInvoice(ctx.from.id)); //  метод replyWithInvoice для выставления счета
});

bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true)); // ответ на предварительный запрос по оплате

bot.on("successful_payment", async (ctx, next) => {
  // ответ в случае положительной оплаты
  await ctx.reply("SuccessfulPayment");
});

bot.launch();
