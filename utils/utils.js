export const daysToSeconds = (days) => {
  return days * 24 * 60 * 60;
};

export const getSubscriptionStatus = (timeSub) => {
  if (timeSub > Date.now()) return true;
  else return false;
};
