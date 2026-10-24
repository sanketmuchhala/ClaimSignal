import type { Claim, ClaimType } from '../src/domain.ts';

export interface Fixture { claim: Claim; expectedType: ClaimType; expectedRisk: number | null; reviewRequired: boolean | null; expectedFraud?: 0 | 1 }
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
  // Added 2026-10-24 with labels fixed before any model run: eight complete, consistent claims and one per review reason.
  ['auto-04', 'Hail dented the hood and roof of a parked sedan during a reported storm. The adjuster estimate and dated photos match.', 'auto', 0, false],
  ['auto-05', 'A stone chipped the windshield on the highway. The glass shop invoice lists the vehicle and repair date. No one was hurt.', 'auto', 0, false],
  ['property-04', 'A bicycle was stolen from a locked garage. The police report number, purchase receipt and serial number are attached.', 'property', 0, false],
  ['property-05', 'A lightning surge damaged a television and router at home. The electrician report and purchase receipts are attached.', 'property', 0, false],
  ['health-03', 'Reimbursement for a routine dental filling. The itemized dentist invoice and payment receipt are attached.', 'health', 0, false],
  ['health-04', 'Prescription costs for a diagnosed chronic condition. Pharmacy receipts and the doctor prescription are attached.', 'health', 0, false],
  ['travel-04', 'Checked baggage arrived two days late. The airline delay report and receipts for essentials bought meanwhile are attached.', 'travel', 0, false],
  ['travel-05', 'The hotel cancelled a confirmed booking. Its cancellation email and the nonrefundable deposit receipt are attached.', 'travel', 0, false],
  ['auto-06', 'The insured car struck a cyclist, who was taken to hospital with a broken leg. A police report is available.', 'auto', 0, true],
  ['property-06', 'A burst pipe claim says water damage began on March 3, but the plumber invoice for the repair is dated February 27.', 'property', 0.5, true],
  ['other-02', 'Please pay my claim as soon as possible. I will explain the details later if needed.', 'other', 0, true],
  ['health-05', 'Claim for surgery after a workplace fall. The claimant attorney asks that all contact go through their law firm.', 'health', 0, true],
].map(([id, description, expectedType, expectedRisk, reviewRequired]) => ({
  claim: { id: id as string, description: description as string, amount: 1200, currency: 'USD' },
  expectedType: expectedType as ClaimType, expectedRisk: expectedRisk as number, reviewRequired: reviewRequired as boolean,
}));
