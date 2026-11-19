export const classes = [
  { code: 'SL', name: 'Sleeper', coach: 'S1', fare: 320, max: 12 },
  { code: '3A', name: 'AC 3 Tier', coach: 'B1', fare: 840, max: 24 },
  { code: '2A', name: 'AC 2 Tier', coach: 'A1', fare: 1260, max: 30 },
  { code: '1A', name: 'First AC', coach: 'H1', fare: 1840, max: Infinity },
];
export const seatClass = (number) => classes.find((item) => number <= item.max);
