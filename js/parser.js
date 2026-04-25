/**
 * parser.js
 * Detects reservation fields from raw PDF text extracted by pdfExtractor.js.
 *
 * Design principles:
 *  - Each detector is an isolated function returning { value, confidence } or null.
 *  - Confidence levels: 'high' (strong label match), 'medium' (structural match),
 *    'low' (heuristic/fallback).
 *  - If a field cannot be detected confidently, return null rather than guess.
 *  - New fields can be added by writing a new detector and adding it to parse().
 *
 * Depends on: RateCalculator (loaded before this script)
 */
const Parser = (() => {

  // ─── Individual field detectors ─────────────────────────────────────────────

  /**
   * Guest name: "Guest Information: First Last"
   * The name ends at a newline, large whitespace gap, or the start of a zip code.
   */
  function detectGuestName(text) {
    // Primary: "Guest Information: First Last" followed by 2+ spaces, newline, zip code,
    // or a known secondary label (Company/Agent/Group/Source) that shares the same visual line.
    // pdfExtractor joins same-row cells with a single space, so we must also accept
    // a single space before these known label words.
    let m = text.match(/Guest\s+Information[:\s]+([A-Za-z][A-Za-z\s\-'.]{2,40}?)(?=\s{2,}|\n|\s\d{5}|\s+(?:Company|Agent|Group|Source)\b)/i);
    if (m) return { value: m[1].trim(), confidence: 'high' };

    // Conservative fallback: "GUEST: Name" style, but exclude structural labels like
    // "Guest Signature" or "Guest Information" from being captured as a name.
    m = text.match(/GUEST[:\s]+([A-Za-z][A-Za-z\s\-'.]{2,40}?)(?=\s{2,}|\n)/i);
    if (m) {
      const name = m[1].trim();
      if (!/^(signature|information|name|id|number|checkout|checkin)$/i.test(name)) {
        return { value: name, confidence: 'medium' };
      }
    }

    return null;
  }

  /**
   * Confirmation number: a 7–12 digit number that appears just before an
   * arrival date in the booking table row.
   */
  function detectConfirmationNumber(text) {
    // Label-based (most reliable)
    let m = text.match(/Confirmation(?:\s+No\.?|\s+#|\s+Number)?[:\s]+(\d{6,})/i);
    if (m) return { value: m[1].trim(), confidence: 'high' };

    // Structural: long number immediately followed by a date (table row pattern)
    m = text.match(/\b(\d{7,12})\b(?=\s+\d{2}[-\/]\d{2}[-\/]\d{2})/);
    if (m) return { value: m[1], confidence: 'medium' };

    return null;
  }

  /**
   * Arrival date: first date in the booking table row (after the confirmation #).
   */
  function detectArrivalDate(text) {
    let m = text.match(/Arrival\s+(?:Date)?[:\s]+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i);
    if (m) return { value: m[1].trim(), confidence: 'high' };

    // Table row: CONFIRMATION  ARRIVAL  DEPARTURE
    m = text.match(/\b\d{7,12}\b\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})\s+\d{2}[-\/]\d{2}[-\/]\d{2,4}/);
    if (m) return { value: m[1], confidence: 'medium' };

    return null;
  }

  /**
   * Departure date: second date in the booking table row.
   */
  function detectDepartureDate(text) {
    let m = text.match(/Departure\s+(?:Date)?[:\s]+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i);
    if (m) return { value: m[1].trim(), confidence: 'high' };

    // Table row: CONFIRMATION  ARRIVAL  DEPARTURE
    m = text.match(/\b\d{7,12}\b\s+\d{2}[-\/]\d{2}[-\/]\d{2,4}\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})/);
    if (m) return { value: m[1], confidence: 'medium' };

    return null;
  }

  /**
   * Room type: short uppercase code (1–5 chars) after the two dates in the table row.
   * Common codes: PR (Premier), ST (Standard), DL (Deluxe), STE (Suite), etc.
   */
  function detectRoomType(text) {
    // Structural: after CONFIRMATION ARRIVAL DEPARTURE comes ROOM_TYPE.
    // Holiday House room types include BETTER (6 chars) so allow up to 8.
    let m = text.match(/\b\d{7,12}\b\s+\d{2}[-\/]\d{2}[-\/]\d{2,4}\s+\d{2}[-\/]\d{2}[-\/]\d{2,4}\s+([A-Z]{1,8})\b/);
    if (m) return { value: m[1], confidence: 'high' };

    // Label fallback: require a colon separator to avoid matching "Room Type Adults"
    // from the column header row (where "Adults" follows with only a space).
    m = text.match(/Room\s+Type\s*:\s*([A-Za-z]{1,10})/i);
    if (m) return { value: m[1].toUpperCase().trim(), confidence: 'high' };

    return null;
  }

  /**
   * Number of adults from the table row (digit after room type code).
   */
  function detectAdults(text) {
    let m = text.match(/Adults[:\s]+(\d)/i);
    if (m) return { value: m[1], confidence: 'high' };

    // Structural: digit immediately after the room type code (allow up to 8 chars for room type)
    m = text.match(/\b\d{7,12}\b\s+\d{2}[-\/]\d{2}[-\/]\d{2,4}\s+\d{2}[-\/]\d{2}[-\/]\d{2,4}\s+[A-Z]{1,8}\s+(\d)\b/);
    if (m) return { value: m[1], confidence: 'medium' };

    return null;
  }

  /**
   * Nightly rate: prefers the calculated average from date-range lines.
   * Falls back to a "Nightly Rate" label match.
   *
   * When multiple date ranges exist with different rates, the average is
   * weighted by the number of nights in each range.
   */
  function detectNightlyRate(text) {
    // Primary: calculate weighted average from explicit date-range lines
    const rateLines = RateCalculator.parseRateLines(text);
    if (rateLines.length > 0) {
      const avg = RateCalculator.calculateAverage(rateLines);
      if (avg !== null) {
        return { value: String(avg), confidence: 'high', rateLines, isCalculated: true };
      }
    }

    // Fallback: labeled single rate. Use a tight 60-char window so nearby table
    // rows (confirmation numbers, resort fee lines) are excluded.
    const labeledRate = findPositiveRateNearLabel(text, /(?:Avg\.?\s*)?Nightly\s+Rate(?:\s*\([^)]*\))?/i, 60);
    if (labeledRate) return { value: labeledRate, confidence: 'medium' };

    // Last resort: any dollar-ish amount near a rate keyword on the same line
    const fallbackRate = findPositiveRateNearLabel(text, /(?:rate|room)/i, 80);
    if (fallbackRate) return { value: fallbackRate, confidence: 'low' };

    return null;
  }

  function findPositiveRateNearLabel(text, labelPattern, windowSize = 220) {
    const label = text.match(labelPattern);
    if (!label) return null;

    const afterLabel = text.slice(label.index + label[0].length, label.index + label[0].length + windowSize);

    // Require >= 10 to avoid matching incidental numbers (e.g. adults count "2")
    // that may appear adjacent to the USD currency label in the table row.
    const usdAmount = afterLabel.match(/([\d,]+(?:\.\d{2})?)\s*USD/i);
    if (usdAmount) {
      const normalized = usdAmount[1].replace(/[^0-9.]/g, '');
      const num = parseFloat(normalized);
      if (!Number.isNaN(num) && num >= 10) return normalized;
    }

    // Require a decimal point so bare integers (confirmation numbers, date
    // components, room numbers) are never mistaken for a formatted rate.
    const amounts = afterLabel.match(/\$?\s*[\d,]+\.\d{2}\s*(?:USD)?/gi) || [];

    for (const amount of amounts) {
      const normalized = amount.replace(/[^0-9.]/g, '');
      const num = parseFloat(normalized);
      if (!Number.isNaN(num) && num >= 10) return normalized;
    }

    return null;
  }

  /**
   * Guest email address.
   */
  function detectEmail(text) {
    // Strong signal: explicitly labeled email field.
    // Guard against matching the hotel's own contact email, which appears in
    // footers as "Telephone: xxx | Email: hotel@domain.com".
    const emailLabelRe = /(?:Guest\s+)?E-?mail[:\s]+([^\s@]+@[^\s]+\.[^\s,\n]{2,})/gi;
    let m;
    while ((m = emailLabelRe.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 130), m.index);
      const isHotelContact = /telephone|phone|\(\d{3}\)|website|www\./i.test(before);
      if (!isHotelContact) {
        return { value: m[1].trim(), confidence: 'high' };
      }
    }

    // Conservative fallback: only accept emails from lines that look guest-related.
    // This avoids pulling the hotel's contact email from headers/footers.
    const lines = text.split(/\r?\n/);
    const emailRe = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/;
    const guestHintRe = /\b(guest|traveler|customer|occupant|contact)\b/i;
    const hotelHintRe = /\b(hotel|lodge|resort|inn|front\s*desk|website)\b/i;

    for (const line of lines) {
      const emailMatch = line.match(emailRe);
      if (!emailMatch) continue;
      if (!guestHintRe.test(line)) continue;
      if (hotelHintRe.test(line)) continue;
      return { value: emailMatch[1], confidence: 'medium' };
    }

    return null;
  }

  // ─── Main entry point ────────────────────────────────────────────────────────

  /**
   * Parse all known fields from extracted PDF text.
   * Returns a structured object where each key maps to a detector result
   * ({ value, confidence }) or null if the field was not detected.
   *
   * Adding a new field: write a new detectXxx() function above and add it here.
   */
  function parse(text) {
    const rateLines = RateCalculator.parseRateLines(text);

    return {
      guestName:          detectGuestName(text),
      confirmationNumber: detectConfirmationNumber(text),
      arrivalDate:        detectArrivalDate(text),
      departureDate:      detectDepartureDate(text),
      roomType:           detectRoomType(text),
      nightlyRate:        detectNightlyRate(text),
      adults:             detectAdults(text),
      email:              detectEmail(text),
      rateLines,   // raw rate lines kept separately for display in the UI
      rawText: text,
    };
  }

  return { parse };
})();
