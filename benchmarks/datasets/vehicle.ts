import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseClaim } from '../../src/domain.ts';
import type { Claim } from '../../src/domain.ts';

export const datasetInfo = {
  name: 'Vehicle Insurance Claim Fraud Detection',
  kaggle: 'https://www.kaggle.com/datasets/shivamb/vehicle-claim-fraud-detection',
  mirror: 'https://github.com/idris10x/vehicle-insurance-fraud-detection',
  mirrorCommit: 'ee0193ce0a0f2da098dcd35256381ba31baf06c7',
  sourceGitBlob: '8513e8b1deb460c5ba35689caf4220dcc013a2d3',
  localSha256: 'd7dab6086aa186fc82c607d50919067a1599cea45afb4965511fd7da9e935e09',
  rows: 15420,
  license: 'CC0-1.0 (reported in the cited dataset research paper)',
  splitSeed: 'claimsignal-vehicle-v1',
} as const;
export const featureNames = [
  'Month', 'WeekOfMonth', 'DayOfWeek', 'Make', 'AccidentArea',
  'DayOfWeekClaimed', 'MonthClaimed', 'WeekOfMonthClaimed',
  'PolicyType', 'VehicleCategory', 'VehiclePrice', 'Deductible',
  'Days_Policy_Accident', 'Days_Policy_Claim', 'PastNumberOfClaims',
  'AgeOfVehicle', 'PoliceReportFiled', 'WitnessPresent', 'NumberOfCars', 'BasePolicy',
] as const;
export type Split = 'train' | 'validation' | 'test';
export interface VehicleExample { claim: Claim; features: Record<string, string>; fraud: 0 | 1; split: Split; group: string }

// Strict RFC-4180-style parser: quoted commas/newlines and escaped quotes are supported.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else {
      if (closed || c === '"') throw new Error('Malformed CSV quoting');
      field += c;
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  const header = rows.shift();
  if (!header?.length || header.some(k => !k) || new Set(header).size !== header.length) throw new Error('Missing or duplicate CSV headers');
  return rows.map((values, i) => {
    if (values.length !== header.length) throw new Error(`CSV row ${i + 2} has ${values.length} columns; expected ${header.length}`);
    return Object.fromEntries(header.map((key, j) => [key, values[j]]));
  });
}

export function adaptVehicle(row: Record<string, string>): VehicleExample {
  if (!['0', '1'].includes(row.FraudFound_P)) throw new Error('Invalid fraud label');
  if (!/^\d+$/.test(row.PolicyNumber)) throw new Error('Invalid source row identifier');
  const features: Record<string, string> = {};
  for (const name of featureNames) {
    if (typeof row[name] !== 'string' || !row[name].trim()) throw new Error(`Missing feature: ${name}`);
    // Source uses zero as a missing calendar value in a small number of records.
    features[name] = row[name] === '0' ? 'unknown' : row[name];
  }
  const group = createHash('sha256').update(JSON.stringify(features)).digest('hex');
  const bucket = parseInt(createHash('sha256').update(`${datasetInfo.splitSeed}:${group}`).digest('hex').slice(0, 8), 16) / 2 ** 32;
  const split: Split = bucket < 0.6 ? 'train' : bucket < 0.8 ? 'validation' : 'test';
  // Source identifiers are hashed, and labels/demographics/investigation outcomes never enter the narrative.
  const id = 'vehicle-' + createHash('sha256').update(`vehicle:${row.PolicyNumber}`).digest('hex').slice(0, 20);
  const description = 'Structured vehicle insurance claim record. Facts are copied from tabular source fields; this is not an original claimant narrative. Claim amount and currency were not supplied.\n' + featureNames.map(name => `${name}: ${features[name]}`).join('\n');
  return { claim: parseClaim({ id, description, amount: null, currency: null }), features, fraud: Number(row.FraudFound_P) as 0 | 1, split, group };
}

export async function loadVehicle(): Promise<VehicleExample[]> {
  const bytes = await readFile(new URL('../../data/raw/fraud_oracle.csv', import.meta.url));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== datasetInfo.localSha256) throw new Error('Dataset checksum mismatch; review provenance before changing the manifest');
  const rows = parseCsv(bytes.toString('utf8'));
  if (rows.length !== datasetInfo.rows || Object.keys(rows[0]).length !== 33) throw new Error('Unexpected dataset shape');
  const examples = rows.map(adaptVehicle);
  if (new Set(examples.map(e => e.claim.id)).size !== examples.length) throw new Error('Duplicate source identifiers');
  return examples;
}
