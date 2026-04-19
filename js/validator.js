/**
 * validator.js
 * Validates parsed field results and assigns a display status to each.
 *
 * Status levels:
 *  'ok'        - value detected with medium or high confidence
 *  'uncertain' - value detected but confidence is low; staff should verify
 *  'missing'   - required field not detected; staff must fill in manually
 *
 * Required fields missing -> hasErrors = true (blocks card generation warning)
 * Uncertain fields        -> hasWarnings = true (soft warning only)
 */
const Validator = (() => {

  // Fields that must be present for a valid registration card
  const REQUIRED = new Set([
    'guestName',
    'confirmationNumber',
    'arrivalDate',
    'departureDate',
    'roomType',
    'nightlyRate',
  ]);

  // All fields the validator checks (required + optional)
  const ALL_FIELDS = [
    'guestName',
    'confirmationNumber',
    'arrivalDate',
    'departureDate',
    'roomType',
    'nightlyRate',
    'adults',
    'email',
    'phone',
  ];

  /** Validate a single parsed field result. */
  function validateField(key, result) {
    const hasValue = result && result.value != null && String(result.value).trim() !== '';

    if (!hasValue) {
      // Optional fields stay neutral when empty.
      if (!REQUIRED.has(key)) {
        return { status: 'ok', message: '' };
      }

      return {
        status: 'missing',
        message: 'Required - please enter manually',
      };
    }

    if (result.confidence === 'low') {
      return {
        status: 'uncertain',
        message: 'Detected with low confidence - please verify',
      };
    }

    return { status: 'ok', message: '' };
  }

  /**
   * Validate all parsed fields at once.
   * @param {object} parsed - result from Parser.parse()
   * @returns {{ fields: object, hasErrors: boolean, hasWarnings: boolean }}
   */
  function validateAll(parsed) {
    const fields = {};
    let hasErrors = false;
    let hasWarnings = false;

    for (const key of ALL_FIELDS) {
      const result = validateField(key, parsed[key]);
      fields[key] = result;

      if (result.status === 'missing' && REQUIRED.has(key)) hasErrors = true;
      if (result.status === 'uncertain') hasWarnings = true;
    }

    return { fields, hasErrors, hasWarnings };
  }

  return { validateAll, validateField };
})();
