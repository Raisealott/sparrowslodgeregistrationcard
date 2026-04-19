/**
 * formPrefiller.js
 * Populates the review form with parsed field values and applies
 * visual validation states to each field wrapper.
 *
 * Depends on: FieldNormalizer (for date/rate formatting)
 */
const FormPrefiller = (() => {

  // Maps each parsed field key → the id of its <input> in the review form
  const INPUT_IDS = {
    guestName:          'field-guest-name',
    confirmationNumber: 'field-confirmation',
    arrivalDate:        'field-arrival',
    departureDate:      'field-departure',
    roomType:           'field-room-type',
    nightlyRate:        'field-nightly-rate',
    adults:             'field-adults',
    email:              'field-email',
    phone:              'field-phone',
  };

  /** Apply a parsed value to a single review form field. */
  function fillField(key, result, validationResult) {
    const inputEl   = document.getElementById(INPUT_IDS[key]);
    const wrapperEl = inputEl?.closest('.field-wrapper');
    if (!inputEl || !wrapperEl) return;

    // Set the input value, normalizing dates and rates for display
    if (result?.value != null) {
      if (key === 'arrivalDate' || key === 'departureDate') {
        inputEl.value = FieldNormalizer.normalizeDate(result.value) ?? result.value;
      } else if (key === 'nightlyRate') {
        const num = FieldNormalizer.normalizeRate(result.value);
        inputEl.value = num !== null ? num.toFixed(2) : result.value;
      } else {
        inputEl.value = result.value;
      }
    } else {
      inputEl.value = '';
    }

    // Apply color-coded status to the wrapper
    wrapperEl.classList.remove('status-ok', 'status-missing', 'status-uncertain');
    wrapperEl.classList.add(`status-${validationResult.status}`);

    const hintEl = wrapperEl.querySelector('.field-hint');
    if (hintEl) hintEl.textContent = validationResult.message;
  }

  /**
   * Render rate lines below the nightly rate input.
   * Shows each date range and the calculated average to give staff full context.
   */
  function renderRateLines(rateLines, avgRate) {
    const container = document.getElementById('rate-lines-display');
    if (!container || !rateLines?.length) return;

    container.innerHTML = '';

    rateLines.forEach(line => {
      const el = document.createElement('div');
      el.className = 'rate-line';
      el.textContent = `${line.startDate} – ${line.endDate}:  $${line.rate.toFixed(2)} USD`;
      container.appendChild(el);
    });

    if (avgRate != null) {
      const num = FieldNormalizer.normalizeRate(avgRate);
      if (num !== null) {
        const avgEl = document.createElement('div');
        avgEl.className = 'rate-avg';
        avgEl.textContent = `Weighted average: ${FieldNormalizer.formatRate(num)} / night`;
        container.appendChild(avgEl);
      }
    }

    container.style.display = 'block';
  }

  /**
   * Fill all fields in the review form from parsed data + validation results.
   * @param {object} parsed     — result from Parser.parse()
   * @param {object} validation — result from Validator.validateAll()
   */
  function fillAll(parsed, validation) {
    for (const key of Object.keys(INPUT_IDS)) {
      fillField(
        key,
        parsed[key],
        validation.fields[key] ?? { status: 'ok', message: '' }
      );
    }

    if (parsed.rateLines?.length > 0) {
      renderRateLines(parsed.rateLines, parsed.nightlyRate?.value);
    }
  }

  return { fillAll };
})();
