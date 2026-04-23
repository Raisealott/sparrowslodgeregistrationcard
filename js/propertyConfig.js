/**
 * propertyConfig.js
 * Per-property branding and policy copy for the multi-tenant app.
 */
const PropertyConfig = (() => {
  const DEFAULT_SLUG = 'sparrows-lodge';

  const CONFIGS = {
    'sparrows-lodge': {
      name: 'Sparrows Lodge',
      subTitle: 'Palm Springs',
      logoSrc: 'assets/logo.png',
      logoAlt: 'Sparrows Lodge logo',
      guestHomeLogoSrc: 'assets/logo birds only.png',
      completeImageSrc: 'assets/youre all set bird.png',
      addressLines: [
        '1330 E. Palm Canyon Drive - Palm Springs, California 92264',
        '(760) 327-2300 - hello@sparrowslodge.com - sparrowslodge.com',
      ],
      policyGreeting: "Greetings from Sparrow's Lodge!",
      policyParagraphs: [
        "Sparrow's Lodge has a 48-hour cancellation policy. In the event of an early departure, one night's room and tax will be applied to your bill. Payment of all charges must be secured at check-in. Sparrow's Lodge offers physical room keys - you may be charged $100 for any lost keys.",
        'Payment may be made by acceptable credit, debit card, or other management-approved billing methods. Guests paying by credit card acknowledge that their card will be preauthorized for all room and tax charges. Additional authorization is taken to secure guest incidental charges. This includes incidentals or guests whose room and tax charges are being paid by a third party. Any unused authorization is released at the time of check-out. Please note that your financial institution will determine how quickly the authorization is released back to your account.',
        "For your convenience, Sparrow's Lodge will create a running account for your charges made at the lobby bar/restaurant. Unless instructed otherwise, a 20% auto gratuity will be automatically added to your account.",
        'Pool Hours: 6 am - 11 pm | Flotation devices, any type of ball, and/or amplified music are not permitted in the pool area. Pool use is exclusive to registered guests. There is no glass by the pool at any time. All outside Food and Beverages are strictly prohibited in public areas.',
        "Sparrow's Lodge is not responsible for property lost, stolen, or left behind on the property. Sparrow's Lodge offers outdoor parking for guests' convenience and is not responsible for any lost or stolen items from vehicles or damage to vehicles parked on the property.",
        "Sparrow's Lodge is 100% non-smoking. A smoking and cleaning fee of $250 will be charged to any room where evidence of smoking is found.",
        'We welcome dogs less than 40 pounds with a one-time fee of $100 per stay, per dog. All dogs are required to be on a leash at all times.',
        'For your convenience and to enhance your guest experience, we welcome you to participate in the daily resort fee upon arrival. The resort fee includes access to the property Wi-Fi, the Sparrows Lodge breakfast, overnight self-parking, and more. Valued at $75, these amenities are available to our guests for $40 per night.',
      ],
      resortFeeOptInText: 'Opt In - welcome drink, breakfast, bikes, smores, wifi & more ($40 per night)',
      signatureAgreement: 'By signing above you agree to Sparrows Lodge hotel policies.',
    },
    'holiday-house': {
      name: 'Holiday House',
      subTitle: 'Palm Springs',
      logoSrc: 'assets/Holiday House logo.png',
      logoAlt: 'Holiday House logo',
      guestHomeLogoSrc: 'assets/HH logo.png',
      completeImageSrc: null,
      addressLines: [
        '200 W. Arenas Road - Palm Springs, California 92262',
        '(760) 320-8866 - hello@holidayhouseps.com - holidayhouseps.com',
      ],
      policyGreeting: 'Greetings from Holiday House!',
      policyParagraphs: [
        "Holiday House has a 48-hour cancellation policy. In the event of an early departure, one night's room and tax will be applied to your bill. Payment of all charges must be secured at check-in.",
        'Payment may be made by acceptable credit, debit card, or other management-approved billing methods. Guests paying by credit card acknowledge that their card will be preauthorized for all room and tax charges. Additional authorization is taken to secure guest incidental charges. Any unused authorization is released at check-out according to your financial institution timeline.',
        'Holiday House is an adults-only property. Guests must be 21 and over to check in, and rooms are limited to two guests.',
        'Holiday House is a small property and asks guests to keep things quiet so everyone may enjoy their stay. Rooms do not have televisions or phones.',
        'Pool and public areas are reserved for registered guests. Glass, outside food and beverages, amplified music, flotation devices, and ball play are not permitted in the pool area.',
        'Holiday House is not responsible for property lost, stolen, or left behind on the property. Outdoor parking is offered for guest convenience, and Holiday House is not responsible for lost or stolen items from vehicles or damage to vehicles parked on the property.',
        'Holiday House is 100% non-smoking. A smoking and cleaning fee may be charged to any room where evidence of smoking is found.',
        'Well-behaved dogs under 40 pounds are welcome with a one-time fee of $100 per stay, per dog. Dogs must be on a leash whenever they are outside of the guest room.',
        'Holiday House charges an optional $40 daily resort fee. The resort fee includes self-parking, daily continental breakfast, morning coffee service, bicycle rentals, Wi-Fi, and newspaper service.',
      ],
      resortFeeOptInText: 'Opt In - parking, breakfast, coffee, bikes, wifi & more ($40 per night)',
      signatureAgreement: 'By signing above you agree to Holiday House hotel policies.',
    },
  };

  function current() {
    const property = typeof Auth !== 'undefined' ? Auth.getProperty?.() : null;
    return forProperty(property);
  }

  function forProperty(property) {
    const slug = property?.slug || DEFAULT_SLUG;
    const base = CONFIGS[slug] || CONFIGS[DEFAULT_SLUG];
    return {
      ...base,
      ...property,
      name: property?.name || base.name,
      addressLines: base.addressLines,
    };
  }

  return { current, forProperty };
})();

window.PropertyConfig = PropertyConfig;
