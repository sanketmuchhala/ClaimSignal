import type { Claim, ClaimType } from '../src/domain.ts';

export interface Fixture { claim: Claim; expectedType: ClaimType; expectedRisk: number; reviewRequired: boolean }
// Hand-authored synthetic smoke fixtures, not a representative insurance dataset.
export const fixtures: Fixture[] = [
  ['auto-01', 'A parked car suffered a cracked bumper after a low speed collision. Repair estimate and photos agree. No injuries.', 'auto', 0, false],
  ['auto-02', 'An auto theft claim includes two incompatible vehicle identification numbers and a reused police report.', 'auto', 0.75, true],
  ['property-01', 'A burst water pipe damaged a kitchen floor. Plumber invoice and photographs document the same loss.', 'property', 0, false],
  ['property-02', 'A roof damage claim contains three invoices with altered dates and receipts duplicated from an earlier claim.', 'property', 0.75, true],
  ['health-01', 'Reimbursement for an outpatient diagnostic scan. Itemized hospital bill and referral are attached in the record.', 'health', 0, false],
  ['health-02', 'A medical expense claim has a hospital invoice for a patient name different from the insured patient.', 'health', 0.5, true],
  ['travel-01', 'An airline cancelled a flight. The booking receipt and airline cancellation notice support the trip expense.', 'travel', 0, false],
  ['travel-02', 'Lost baggage claim includes receipts the claimant explicitly admits fabricating to inflate the loss.', 'travel', 1, true],
  ['other-01', 'I had an incident and need reimbursement, but I have not described the property, event, or expense yet.', 'other', 0, true],
  ['auto-03', 'Rear-end car collision caused a passenger injury requiring emergency treatment. Police report is available.', 'auto', 0, true],
  ['property-03', 'A tree fell on a detached garage. Contractor estimate matches the dated storm photographs. No injuries.', 'property', 0, false],
  ['travel-03', 'A flight delay caused an overnight hotel stay. The receipt and carrier delay notice agree.', 'travel', 0, false],
].map(([id, description, expectedType, expectedRisk, reviewRequired]) => ({
  claim: { id: id as string, description: description as string, amount: 1200, currency: 'USD' },
  expectedType: expectedType as ClaimType, expectedRisk: expectedRisk as number, reviewRequired: reviewRequired as boolean,
}));
