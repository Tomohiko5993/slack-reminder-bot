const holidays = require('@holiday-jp/holiday_jp');

/**
 * 指定した日付が日本の祝日かどうかを判定
 * @param {Date} date
 * @returns {boolean}
 */
function isJapaneseHoliday(date) {
  return holidays.isHoliday(date);
}

/**
 * 指定した日付が「稼働日」かどうかを判定
 * 土日 or 祝日 → false
 * @param {Date} date
 * @returns {boolean}
 */
function isWorkday(date) {
  const day = date.getDay(); // 0=日, 6=土
  if (day === 0 || day === 6) return false;
  if (isJapaneseHoliday(date)) return false;
  return true;
}

/**
 * スキャン開始タイムスタンプ（Unix秒）を計算する
 *
 * ルール:
 *   朝8:00実行  → 直前の稼働日の18:00 〜 今日の7:59
 *   夕18:00実行 → 今日の8:00 〜 17:59
 *
 * 月曜朝（または祝日明け朝）は、直前稼働日（金曜など）の18:00まで遡る
 * → 土日・連休中のメッセージを全回収
 *
 * @param {'morning'|'evening'} session
 * @param {Date} now  現在時刻 (JST)
 * @returns {{ oldest: number, latest: number }}
 */
function getScanRange(session, now) {
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

  if (session === 'evening') {
    // 夕スキャン: 今日8:00〜17:59
    const start = new Date(jstNow);
    start.setHours(8, 0, 0, 0);
    const end = new Date(jstNow);
    end.setHours(17, 59, 59, 999);
    return { oldest: Math.floor(start.getTime() / 1000), latest: Math.floor(end.getTime() / 1000) };
  }

  // 朝スキャン: 直前稼働日の18:00〜今日7:59
  const todayEnd = new Date(jstNow);
  todayEnd.setHours(7, 59, 59, 999);

  // 直前の稼働日を探す（最大14日前まで）
  let prevWorkday = new Date(jstNow);
  prevWorkday.setDate(prevWorkday.getDate() - 1);
  for (let i = 0; i < 14; i++) {
    if (isWorkday(prevWorkday)) break;
    prevWorkday.setDate(prevWorkday.getDate() - 1);
  }
  prevWorkday.setHours(18, 0, 0, 0);

  return {
    oldest: Math.floor(prevWorkday.getTime() / 1000),
    latest: Math.floor(todayEnd.getTime() / 1000),
  };
}

module.exports = { isWorkday, isJapaneseHoliday, getScanRange };
