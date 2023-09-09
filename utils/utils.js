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
