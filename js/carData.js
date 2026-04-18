const CarData = (() => {

  const BRANDS_MODELS = {
    'Toyota':       ['RAV4', 'Camry', 'Corolla', 'Tacoma'],
    'Ford':         ['F-150', 'Explorer', 'Mustang', 'Escape'],
    'Chevrolet':    ['Silverado', 'Equinox', 'Tahoe', 'Malibu'],
    'Honda':        ['CR-V', 'Civic', 'Accord', 'Pilot'],
    'Hyundai':      ['Tucson', 'Elantra', 'Santa Fe', 'Ioniq 5'],
    'Nissan':       ['Rogue', 'Altima', 'Sentra', 'Frontier'],
    'Kia':          ['Sportage', 'Telluride', 'Forte', 'EV6'],
    'GMC':          ['Sierra', 'Yukon', 'Terrain', 'Canyon'],
    'Subaru':       ['Outback', 'Forester', 'Crosstrek', 'Impreza'],
    'Jeep':         ['Wrangler', 'Grand Cherokee', 'Compass', 'Gladiator'],
    'Lexus':        ['RX', 'NX', 'ES', 'GX'],
    'Tesla':        ['Model Y', 'Model 3', 'Model X', 'Model S'],
    'BMW':          ['3 Series', '5 Series', 'X3', 'X5'],
    'Mercedes-Benz':['C-Class', 'E-Class', 'GLE', 'GLC'],
    'Audi':         ['A4', 'A6', 'Q5', 'Q7'],
    'Acura':        ['MDX', 'RDX', 'TLX', 'Integra'],
    'Infiniti':     ['QX60', 'QX50', 'Q50', 'QX80'],
    'Cadillac':     ['Escalade', 'XT5', 'XT6', 'CT5'],
    'Volvo':        ['XC90', 'XC60', 'XC40', 'S60'],
    'Porsche':      ['911', 'Cayenne', 'Macan', 'Taycan'],
    'Land Rover':   ['Range Rover', 'Range Rover Sport', 'Defender', 'Discovery'],
    'Genesis':      ['GV70', 'GV80', 'G70', 'G80'],
  };

  const brands    = Object.keys(BRANDS_MODELS);
  const allModels = [...new Set(Object.values(BRANDS_MODELS).flat())].sort();

  function suggestBrands(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return brands.filter(b => b.toLowerCase().startsWith(q)).slice(0, 5);
  }

  function suggestModels(query, brandInput) {
    if (!query) return [];
    const q           = query.toLowerCase();
    const matchedBrand = brands.find(b =>
      b.toLowerCase() === (brandInput || '').toLowerCase().trim()
    );
    const pool = matchedBrand ? BRANDS_MODELS[matchedBrand] : allModels;
    return pool.filter(m => m.toLowerCase().startsWith(q)).slice(0, 5);
  }

  return { suggestBrands, suggestModels };
})();
