// The 193 Member States of the United Nations, as the UN Transcripts label
// their delegations (official short names). Used where only a Member State's
// delegation counts: a statement on behalf of a group of States (
// 2026-11-19) is never the presidency giving the floor, the Secretariat, a
// rapporteur or a staff body. Observer States (Holy See, State of Palestine)
// and the EU also speak for groups (speaksForStates); other organisations do
// not. Pure.

const NAMES = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia (Plurinational State of)',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'Brunei Darussalam',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Congo',
  'Costa Rica',
  "Côte d'Ivoire",
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czechia',
  "Democratic People's Republic of Korea",
  'Democratic Republic of the Congo',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran (Islamic Republic of)',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kuwait',
  'Kyrgyzstan',
  "Lao People's Democratic Republic",
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia (Federated States of)',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands (Kingdom of the)',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Republic of Korea',
  'Republic of Moldova',
  'Romania',
  'Russian Federation',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syrian Arab Republic',
  'Tajikistan',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Türkiye',
  'Turkmenistan',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom of Great Britain and Northern Ireland',
  'United Republic of Tanzania',
  'United States of America',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Venezuela (Bolivarian Republic of)',
  'Viet Nam',
  'Yemen',
  'Zambia',
  'Zimbabwe',
];

/** Lower case, straight apostrophes, no accents, single spaces. */
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

const SET = new Set(NAMES.map(norm));
// Labels sometimes drop the parenthesis or "of America" ("Iran", "United States", "Netherlands").
const SHORT = new Map(NAMES.map((n) => [norm(n.replace(/\s*\(.*\)$/, '').replace(/ of America$/, '')), norm(n)]));

export const MEMBER_STATE_COUNT = NAMES.length;

/** The official names, as labelled. */
export const MEMBER_STATES: readonly string[] = NAMES;

/** Observer States: delegations too (2026-11-19). */
export const OBSERVER_STATES: readonly string[] = ['Holy See', 'State of Palestine'];
const OBSERVERS = new Set(OBSERVER_STATES.map(norm));

/**
 * Who may deliver a statement on behalf of a group of States (2026-11-19): a State's delegation, Member
 * or observer (Holy See, State of Palestine), or the European Union's, which speaks for its member States ("EU ·
 * EU … on behalf of the European Union and its member States"). Never one that is not a delegation: the
 * presidency, the Secretariat, a rapporteur or a staff body.
 */
export function speaksForStates(label: string): boolean {
  const b = (label.split('·')[0] ?? label).trim();
  return isMemberState(label) || OBSERVERS.has(norm(b)) || /^(EU|European Union)$/i.test(b) || UNIONS.has(norm(b));
}

/** Unions that speak for their member States, beyond the European Union (registered by `extendSpeakers`). */
const UNIONS = new Set<string>();

/**
 * Adds observer States and unions that may deliver a statement on behalf of a group (2026-11-24): for
 * another forum, or for invented test data.
 */
export function extendSpeakers(add: { observers?: readonly string[]; unions?: readonly string[] }): void {
  for (const n of add.observers ?? []) OBSERVERS.add(norm(n));
  for (const n of add.unions ?? []) UNIONS.add(norm(n));
}

/**
 * Adds delegations to the list (2026-11-24): a mission that follows another forum registers its members;
 * the tests register invented States. Names are labelled as the source labels them.
 */
export function extendMemberStates(names: readonly string[]): void {
  for (const n of names) {
    if (SET.has(norm(n))) continue;
    NAMES.push(n);
    SET.add(norm(n));
    SHORT.set(norm(n.replace(/\s*\(.*\)$/, '')), norm(n));
  }
}

/** Whether a speaker label ("Bahrain", "Greece · Prime Minister") is the delegation of a Member State. */
export function isMemberState(label: string): boolean {
  const base = norm(label.split('·')[0] ?? label);
  return SET.has(base) || SHORT.has(base);
}
