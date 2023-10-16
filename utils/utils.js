import fs from "fs";

export const daysToSeconds = (days) => {
  return days * 24 * 60 * 60;
};

export const getSubscriptionStatus = (timeSub) => {
  if (timeSub > Date.now()) return true;
  else return false;
};

export const getSubscriptionRemainingTime = (timeSub) => {
  const dateTimeToHumanFormat = (dateTime) => {
    let diffDays = Math.floor(dateTime / 86400000); // days
    let diffHrs = Math.floor((dateTime % 86400000) / 3600000); // hours
    let diffMins = Math.round(((dateTime % 86400000) % 3600000) / 60000); // minutes
    return diffDays + " дней, " + diffHrs + " часов, " + diffMins + " минут";
  };

  const timeNow = Date.now();

  const differenceTime = timeSub - timeNow;

  if (differenceTime <= 0) return false;
  else return dateTimeToHumanFormat(differenceTime);
};

export const parseTimestampToHumanDate = (timeSub) => {
  return new Date(timeSub).toLocaleString();
};

export const parseHumanDateToISO = (date) => {
  // Split the date and time components
  const [datePart, timePart] = date.split(", ");
  const [day, month, year] = datePart.split(".").map(Number);
  const [hours, minutes, seconds] = timePart.split(":").map(Number);

  // Create a new Date object using the components
  const parsedDate = new Date(year, month - 1, day, hours, minutes, seconds);

  // Get the ISO 8601 formatted string
  const iso8601Date = parsedDate.toISOString();

  return iso8601Date;
};

export const timeout = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const parseTableHistory = (items) => {
  const columnWidth = 20; // How wide each column should be

  const keys = Object.keys(items[0]); // Use the keys of our first item to use as column headers

  const headerRow = `| ${keys.map((key) => key.substring(0, columnWidth).padEnd(columnWidth)).join(" | ")} |`; // Build our header row with pipes to separate columns
  const separatorRow = headerRow.replace(/[^|]/g, "-"); // Add a line below our header row

  let rows = [headerRow, separatorRow]; // Start collecting our rows

  for (const item of items) {
    // Now let's look at each item
    let row = [];
    for (const key of keys) {
      row.push(item[key].toString().substring(0, columnWidth).padEnd(columnWidth)); // Add each value with the correct length
    }
    rows.push(`| ${row.map((entry) => entry.substring(0, columnWidth).padEnd(columnWidth)).join(" | ")} |`); // Store the complete row
  }

  return "<pre>\n" + rows.join("\n") + "\n</pre>";
};

import { jsPDF } from "jspdf";
import "jspdf-autotable";

import _ from "lodash";

export const createPDFReportAutoTable = (sourceData, fileName) => {
  function convertValuesToStringsDeep(obj) {
    return _.cloneDeepWith(obj, (value) => {
      return !_.isPlainObject(value) ? _.toString(value) : undefined;
    });
  }

  const data = sourceData.map((item) => convertValuesToStringsDeep(item));

  function createHeaders(keys) {
    let result = [];

    for (var i = 0; i < keys.length; i += 1) {
      result.push({
        id: keys[i],
        name: keys[i],
        prompt: keys[i],
        width: 65,
        align: "center",
        padding: 0,
      });
    }
    return result;
  }

  let headers = createHeaders(Object.keys(data[0]).map((s) => s.toString()));

  let doc = new jsPDF({
    putOnlyUsedFonts: true,
    orientation: "l", // landscape
  });

  // autoTable(doc, {
  //   head: headers,
  //   body: data,
  // });

  doc.autoTable({
    head: [Object.keys(data[0])],
    body: data.map((item) => Object.values(item)),
  });
  // doc.table(10, 10, data, headers, { autoSize: true });
  doc.save(fileName);

  return doc;
};

// import './Arial Cyr Regular-normal.js'

export const createPDFReport = (sourceData, fileName) => {
  function convertValuesToStringsDeep(obj) {
    return _.cloneDeepWith(obj, (value) => {
      return !_.isPlainObject(value) ? _.toString(value) : undefined;
    });
  }

  const data = sourceData.map((item) => convertValuesToStringsDeep(item));

  function createHeaders(keys) {
    let result = [];

    for (var i = 0; i < keys.length; i += 1) {
      result.push({
        id: keys[i],
        name: keys[i],
        prompt: keys[i],
        width: 65,
        align: "center",
        padding: 0,
      });
    }
    return result;
  }

  let headers = createHeaders(Object.keys(data[0]).map((s) => s.toString()));

  let doc = new jsPDF({
    putOnlyUsedFonts: true,
    orientation: "l", // landscape
  });

  // doc.addFont('Arial Cyr Regular-normal.ttf', 'Arial Cyr Regular')

  doc.table(10, 10, data, headers, { autoSize: true });
  doc.save(fileName);

  return doc;
};

export const sendHistoryFile = async (historySource, location, fileName, bot, chatId, handleEmptyMessage) => {
  const history = historySource.map((item) => ({
    ...item,
    time_sub: parseTimestampToHumanDate(item.time_sub),
    payment_date: parseTimestampToHumanDate(item.payment_date),
  }));

  if (history.length) {
    if (!fs.existsSync(location)) fs.mkdirSync(location);

    createPDFReportAutoTable(history, location + fileName);

    const fileOpts = {
      file: "Buffer",
      filename: fileName,
      contentType: "application/pdf",
    };

    const file = await fs.promises.readFile(location + fileName);

    await bot.sendDocument(chatId, file, fileOpts, {
      filename: fileName,
      contentType: "application/pdf",
    });

    await fs.promises.unlink(location + fileName);
  } else {
    await bot.sendMessage(chatId, handleEmptyMessage);
  }
};

export const createUserResponse = async (bot, chatId, questionText, answerText, badAnswerText, maxAttempts) => {
  let answer = "";
  let count = 0;

  const namePrompt = await bot.sendMessage(chatId, questionText, {
    reply_markup: {
      force_reply: true,
    },
  });

  await bot.onReplyToMessage(chatId, namePrompt.message_id, async (nameMsg) => {
    answer = nameMsg.text;
    // save name in DB if you want to ...
    await bot.sendMessage(chatId, answerText);
  });

  while (answer === "" && count < maxAttempts) {
    console.log("Waiting for user answer");
    await timeout(2000);
    ++count;
  }

  if (answer === "") {
    await bot.sendMessage(chatId, badAnswerText);
    return null;
  } else return answer;
};

export const createUserResponseManaged = async (bot, chatId, replyManager, regexMask, answerText, badAnswerText) => {
  return await new Promise((resolve) => {
    replyManager.register(chatId, (result) => {
      if (result.text.match(regexMask)) {
        bot.sendMessage(chatId, answerText);
        resolve(result.text);
        return { repeat: false };
      } else {
        bot.sendMessage(chatId, badAnswerText);
        return { repeat: true };
      }
    });
  });
};
