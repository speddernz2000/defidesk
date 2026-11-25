// Delta-hedge analysis for a concentrated LP position (ETH/USDC-style: one volatile token, one stablecoin).
import { Position } from './math.js';

/**
 * Closed-form results (verified against a simulation of an hourly delta hedge):
 *  - ETH held:            x(p) = L (1/sqrt(p) - 1/sqrt(pu))       (x_max at the lower bound, 0 above the range)
 *  - gamma cost (APR):    sigma^2 / (4 (2 - sqrt(p/pu) - sqrt(pl/p)))   [full range: sigma^2 / 8]
 *  - break-even fee APR:  gamma cost + (trading cost - funding received) / time-in-range
 *  - unhedged break-even: solve V(p) = C - fees earned
 */
export function hedgeAnalysis({ capital, p0, lower, upper, feeIn, timeIn, sigmaDaily, fundingPct = 0, tradeCostPct = 0, feesEarned = 0 }) {
  const pos = new Position(capital, p0, lower, upper), L = pos.L, full = pos.full;
  const sa = sigmaDaily * Math.sqrt(365);                                   // yearly volatility
  const x0 = pos.amounts(p0).volatile;
  const xmax = full ? null : L * (1 / Math.sqrt(lower) - 1 / Math.sqrt(upper));
  const ymax = full ? null : L * (Math.sqrt(upper) - Math.sqrt(lower));
  const gammaAPR = (full ? (sa * sa) / 8 : (sa * sa) / (4 * (2 - Math.sqrt(p0 / upper) - Math.sqrt(lower / p0)))) * 100;
  const ethShare = (x0 * p0) / capital;
  const fundingEq = fundingPct * ethShare;                                   // funding on the short, as % of capital per year
  const f = Math.max(timeIn, 0.05);
  const breakEvenAPR = gammaAPR + (tradeCostPct - fundingEq) / f;           // fee APR needed while in range
  const netAPR = f * (feeIn - gammaAPR) + fundingEq - tradeCostPct;         // expected hedged return, % of capital per year

  // Re-hedge band: with a hedge set at today's delta, adjust once the ETH held drifts by 10% of its maximum.
  let bands = null;
  if (!full) {
    const step = 0.1 * xmax, priceAt = (x) => { const inv = x / L + 1 / Math.sqrt(upper); return 1 / (inv * inv); };
    bands = { stepEth: step, up: x0 - step > 0 ? priceAt(x0 - step) : upper, down: x0 + step < xmax ? priceAt(x0 + step) : lower };
  }
  // Unhedged: price at which the position's value plus fees earned falls back to the starting capital.
  const target = capital - feesEarned; let beDown;
  if (full) beDown = { price: Math.pow(target / (2 * L), 2), where: 'inside' };
  else if (target <= xmax * lower) beDown = { price: target / xmax, where: 'below' };
  else { const inner = 1 - (Math.sqrt(lower) + target / L) / Math.sqrt(upper); const s = Math.sqrt(upper) * (1 - Math.sqrt(Math.max(inner, 0))); beDown = { price: s * s, where: 'inside' }; }
  return { full, x0, xmax, ymax, valueAtLower: full ? null : xmax * lower, gammaAPR, ethShare, fundingEq, breakEvenAPR, netAPR, bands, beDown, sigmaAnnual: sa };
}
