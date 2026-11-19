const field = (name, label, pattern) => ({ name, label, pattern });
const train = field('train', 'Train number', '[0-9]{5}');
const station = field('station', 'Station code', '[A-Za-z0-9]{1,6}');
const from = { ...station, name: 'from', label: 'Departure station code' };
const to = { ...station, name: 'to', label: 'Arrival station code' };
const date = field('date', 'Date (DD-MM-YYYY)', '[0-9]{2}-[0-9]{2}-[0-9]{4}');
const name = field('name', 'Name', "[A-Za-z0-9 .'-]{2,60}");
const cabin = field('class', 'Class code (e.g. SL, 3A)', '[A-Za-z0-9]{1,3}');
const quota = field('quota', 'Quota code (e.g. GN, TQ)', '[A-Za-z]{2}');
const journey = [train, from, to, date, cabin, quota];

export const lookups = [
  ['checkPNRStatus', 'PNR status', field('pnr', 'PNR number', '[0-9]{10}')],
  ['searchTrainBetweenStations', 'Trains between stations', from, to],
  ['getTrainInfo', 'Train timetable', train],
  ['trackTrain', 'Running status', train, date],
  ['trackTrainV2', 'Running status (alternate feed)', train, date],
  ['getTrainDelays', 'Train delays', train],
  ['getTrainHistory', 'Train running history', train, date],
  ['liveAtStation', 'Live departures at a station', station],
  ['getAvailability', 'Seat availability', ...journey],
  ['fareLookup', 'Fare estimate', ...journey],
  ['cancelList', 'Cancelled trains'],
  ['stationByCode', 'Find a station by code', station],
  ['stationAmenities', 'Station facilities', station],
  ['stationsByName', 'Find a station by name', name],
  ['trainByNumber', 'Find a train by number', train],
  ['trainsByName', 'Find a train by name', name],
  ['trainTimetableAtStation', 'Station timetable', station, date],
  ['getLiveTrainMap', 'Live train locations']
];
