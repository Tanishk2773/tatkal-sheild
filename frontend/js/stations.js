/* Selected stations from the Indian Railways Station Code Index.
   Names use common search spellings, with CSMT updated to the current code.
   Source: https://indianrailways.gov.in/railwayboard/uploads/directorate/coaching/pdf/Station_code.pdf
*/
export const stations = [
  ['AGTL', 'Agartala'], ['AGC', 'Agra Cantt'], ['ADI', 'Ahmedabad'],
  ['AII', 'Ajmer Junction'], ['ALLP', 'Alappuzha'], ['ASR', 'Amritsar Junction'],
  ['BDTS', 'Bandra Terminus'], ['BPL', 'Bhopal Junction'], ['BBS', 'Bhubaneswar'],
  ['CDG', 'Chandigarh'], ['MAS', 'Chennai Central', 'MGR Chennai Central'],
  ['MS', 'Chennai Egmore'], ['CBE', 'Coimbatore Junction'],
  ['DDN', 'Dehradun'], ['DLI', 'Old Delhi', 'Delhi Junction'],
  ['GHY', 'Guwahati'], ['HW', 'Haridwar'], ['NZM', 'Hazrat Nizamuddin'],
  ['HWH', 'Howrah Junction'], ['HYB', 'Hyderabad Deccan', 'Nampally'],
  ['INDB', 'Indore Junction'], ['JBP', 'Jabalpur'], ['JP', 'Jaipur Junction'],
  ['JAT', 'Jammu Tawi'], ['CNB', 'Kanpur Central'], ['KOAA', 'Kolkata'],
  ['SBC', 'KSR Bengaluru', 'Bangalore City'], ['LTT', 'Lokmanya Tilak Terminus'],
  ['LKO', 'Lucknow', 'Lucknow Charbagh'], ['LJN', 'Lucknow Junction'],
  ['MAO', 'Madgaon', 'Margao', 'Goa'], ['MDU', 'Madurai Junction'],
  ['BCT', 'Mumbai Central'], ['CSMT', 'Mumbai CSMT', 'Mumbai CST', 'CSTM', 'Chhatrapati Shivaji Maharaj Terminus'],
  ['MYS', 'Mysuru Junction', 'Mysore'], ['NGP', 'Nagpur Junction'],
  ['NDLS', 'New Delhi'], ['NJP', 'New Jalpaiguri'], ['PNBE', 'Patna Junction'],
  ['PUNE', 'Pune Junction', 'Pune Jn'], ['PURI', 'Puri'], ['R', 'Raipur Junction'],
  ['RJT', 'Rajkot Junction'], ['SC', 'Secunderabad Junction'], ['ST', 'Surat'],
  ['BRC', 'Vadodara Junction'], ['BSB', 'Varanasi Junction'],
  ['BZA', 'Vijayawada Junction'], ['VSKP', 'Visakhapatnam', 'Vizag']
];

export const stationLabel = ([code, name]) => name + ' (' + code + ')';

function normalize(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function resolveStation(value) {
  const term = normalize(value);
  if (!term) return null;
  const exact = stations.find(station =>
    normalize(stationLabel(station)) === term || station.some(value => normalize(value) === term)
  );
  if (exact) return exact;
  const matches = stations.filter(station => station.slice(1).some(name => normalize(name).startsWith(term)));
  return matches.length === 1 ? matches[0] : null;
}
