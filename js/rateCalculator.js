/**
 * rateCalculator.js
 * Parses date-range rate lines from PDF text and calculates a weighted average
 * nightly rate.
 *
 * Example input text fragment:
 *   "02-22-26 - 02-24-26  389.00 USD"
 *   "02-25-26 - 02-25-26  459.00 USD"
 *
 * Night-count rule: each date in the range represents one night the guest
 * occupies the room, so a range of 02-22 to 02-24 covers 3 nights (not 2).
 * Formula: nights = daysBetween(start, end) + 1
 */
const RateCalculator = (() => {

  /** Parse "MM-DD-YY" or "MM/DD/YY" into a Date (midnight UTC). */
  function parseDate(str) {
    const m = str.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
    if (!m) return null;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10)));
  }

  /**
   * Count the number of nights covered by a date range.
   * "02-22-26 to 02-24-26" → 3 nights (22nd, 23rd, 24th).
   */
  function nightsInRange(startStr, endStr) {
    const start = parseDate(startStr);
    const end   = parseDate(endStr);
    if (!start || !end) return 0;
    const diffMs   = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / 86_400_000);
    return Math.max(diffDays + 1, 1); // minimum 1 night
  }

  /**
   * Extract all date-range rate lines from raw PDF text.
   * Returns an array of: { startDate, endDate, rate, raw }
   *
   * Matches patterns like:
   *   "02-22-26 - 02-24-26  389.00 USD"
   *   "02/22/26 – 02/24/26  $389"
   */
  function parseRateLines(text) {
    const lines = [];
    // Matches: DATE [-–] DATE  AMOUNT [USD]
    const pattern = /(\d{2}[-\/]\d{2}[-\/]\d{2,4})\s*[-–]\s*(\d{2}[-\/]\d{2}[-\/]\d{2,4})\s+([\d,]+\.?\d*)\s*(?:USD)?/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const rate = parseFloat(match[3].replace(/,/g, ''));
      if (!isNaN(rate) && rate > 0) {
        lines.push({
          startDate: match[1],
          endDate:   match[2],
          rate,
          raw: match[0].trim(),
        });
      }
    }
    return lines;
  }

  /**
   * Calculate the weighted average nightly rate from an array of rate lines.
   * Returns a float rounded to 2 decimal places, or null if input is empty.
   */
  function calculateAverage(rateLines) {
    if (!rateLines || rateLines.length === 0) return null;

    let totalRevenue = 0;
    let totalNights  = 0;

    for (const line of rateLines) {
      const nights = nightsInRange(line.startDate, line.endDate);
      totalRevenue += nights * line.rate;
      totalNights  += nights;
    }

    if (totalNights === 0) return null;
    return Math.round((totalRevenue / totalNights) * 100) / 100;
  }

  return { parseRateLines, calculateAverage, nightsInRange };
})();
