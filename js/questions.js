/**
 * questions.js
 * Data-driven question flow configuration.
 *
 * To add, remove, or reorder questions: edit FLOW only.
 * No other file needs to change for simple flow modifications.
 *
 * Question types:
 *   'welcome'   — Full-screen greeting, no input
 *   'confirm'   — Show prefilled value; guest confirms or taps Edit
 *   'text'      — Single free-text input (inputType: 'text'|'email'|'tel')
 *   'review'    — Auto-generated summary of all collected answers
 *   'signature' — Canvas signature + policy agreement
 *   'complete'  — Thank-you screen, no input
 *
 * Field options:
 *   id           — Unique key; also used as state storage key when field is absent
 *   field        — Key used to read/write the value in guest state
 *   label        — Large heading shown to the guest
 *   subLabel     — Smaller helper text shown below the input
 *   placeholder  — Input placeholder text (text type only)
 *   required     — Block advance if empty (default: false)
 *   editable     — Show an "Edit" button on confirm slides (default: true)
 *   showInReview — Include this field in the review summary (default: true)
 *   reviewLabel  — Override the label shown in the review row
 *   inputType    — HTML input type for text slides (default: 'text')
 */
const Questions = (() => {

  const FLOW = [
    {
      id:   'welcome',
      type: 'welcome',
    },
    {
      id:          'contact',
      type:        'stack',
      label:       'Contact Information',
      subLabel:    '',
      requireOne:  true,
      showInReview: true,
      inputs: [
        { field: 'email', label: 'Email Address', placeholder: 'your@email.com', inputType: 'email', reviewLabel: 'Email' },
        { field: 'phone', label: 'Phone Number',  placeholder: '(760) 555-0100', inputType: 'tel',   reviewLabel: 'Phone' },
      ],
    },
    {
      id:          'vehicle',
      type:        'stack',
      label:       'Vehicle',
      subLabel:    'For our parking records. Tap Continue to skip.',
      required:    false,
      showInReview: true,
      reviewLabel: 'Vehicle',
      inputs: [
        { field: 'carMake',  label: 'Make',  placeholder: '', suggest: 'carBrand' },
        { field: 'carModel', label: 'Model', placeholder: '', suggest: 'carModel' },
        { field: 'carColor', label: 'Color', placeholder: ''   },
      ],
    },
    {
      id:           'policy',
      type:         'policy',
      label:        'Policy & Resort Fee',
      field:        'resortFeeConsent',
      required:     true,
      showInReview: true,
      reviewLabel:  'Resort Fee',
    },
    {
      id:   'signature',
      type: 'signature',
    },
    {
      id:   'complete',
      type: 'complete',
    },
  ];

  return { FLOW };
})();
