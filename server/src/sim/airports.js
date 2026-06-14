// A small European network for the simulation. [lon, lat].
export const AIRPORTS = [
  { code: 'ARN', name: 'Stockholm Arlanda', lon: 17.92, lat: 59.65 },
  { code: 'CPH', name: 'Copenhagen', lon: 12.65, lat: 55.62 },
  { code: 'OSL', name: 'Oslo Gardermoen', lon: 11.1, lat: 60.19 },
  { code: 'HEL', name: 'Helsinki', lon: 24.96, lat: 60.32 },
  { code: 'LHR', name: 'London Heathrow', lon: -0.46, lat: 51.47 },
  { code: 'CDG', name: 'Paris Charles de Gaulle', lon: 2.55, lat: 49.01 },
  { code: 'AMS', name: 'Amsterdam Schiphol', lon: 4.76, lat: 52.31 },
  { code: 'FRA', name: 'Frankfurt', lon: 8.57, lat: 50.04 },
  { code: 'MUC', name: 'Munich', lon: 11.79, lat: 48.35 },
  { code: 'BER', name: 'Berlin Brandenburg', lon: 13.5, lat: 52.36 },
  { code: 'BCN', name: 'Barcelona', lon: 2.08, lat: 41.3 },
  { code: 'MAD', name: 'Madrid Barajas', lon: -3.57, lat: 40.49 },
  { code: 'FCO', name: 'Rome Fiumicino', lon: 12.25, lat: 41.8 },
  { code: 'VIE', name: 'Vienna', lon: 16.57, lat: 48.11 },
  { code: 'ZRH', name: 'Zurich', lon: 8.55, lat: 47.46 },
  { code: 'BRU', name: 'Brussels', lon: 4.48, lat: 50.9 },
  { code: 'DUB', name: 'Dublin', lon: -6.27, lat: 53.43 },
  { code: 'MAN', name: 'Manchester', lon: -2.27, lat: 53.35 },
  { code: 'GVA', name: 'Geneva', lon: 6.11, lat: 46.24 },
  { code: 'LIS', name: 'Lisbon', lon: -9.13, lat: 38.77 },
];

export const AIRPORT_MAP = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));
