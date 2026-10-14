// When rounds lock: every week on the same weekday and hour (UTC), so a round runs from one lock to the next.
// Shared by the deploy (first rounds) and the keeper (every round after that).
const config = require("../config/robinhood.json");

/** The next lock time (unix seconds) at least `minLeadHours` after `now`. */
function nextLockAt(now, r = config.launch.rounds) {
  const d = new Date(now * 1000);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), r.lockHourUtc, 0, 0) / 1000;
  const days = (r.lockWeekdayUtc - d.getUTCDay() + 7) % 7;
  let lockAt = t + days * 86400;
  while (lockAt < now + r.minLeadHours * 3600) lockAt += 7 * 86400;
  return lockAt;
}

module.exports = { nextLockAt };
