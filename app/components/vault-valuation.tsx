import { View } from 'react-native';
import { type VaultHolding } from '../lib/api';
import { money, percent } from '../lib/format';
import { Card, Copy, Disclosure, Row, Signed } from './ui';

/** The manual Vault workbook cadence: review estimates after a year. */
const MANUAL_REVIEW_DAYS = 365;

function shortDate(value: string | null): string {
  if (!value) return 'No date';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function signedMoney(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('-') || /^[+]?0(?:\.0+)?$/.test(trimmed)) return money(trimmed);
  return `+${money(trimmed)}`;
}

function days(value: number): string {
  return `${value} day${value === 1 ? '' : 's'}`;
}

function manualStatus(holding: VaultHolding): string {
  if (holding.value === null) return 'Manual valuation not recorded yet';
  if (holding.days_since_valued === null) return 'Manual valuation age unavailable';
  if (holding.days_since_valued > MANUAL_REVIEW_DAYS) {
    return `Manual valuation is ${holding.days_since_valued} days old · review after ${MANUAL_REVIEW_DAYS} days`;
  }
  return `Manual valuation age: ${days(holding.days_since_valued)}`;
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ flex: 1, minWidth: 130, gap: 3 }}><Copy muted>{label}</Copy><Copy>{children}</Copy></View>;
}

/** The Vault figures for one stock row: cost, manual worth and appreciation, kept apart from profit. */
export function VaultSummary({ holding }: { holding: VaultHolding }) {
  return <>
    <Row>
      <Copy>Vault cost {money(holding.cost)}</Copy>
      <Copy>Appreciation {holding.appreciation === null ? 'Unknown' : <Signed value={holding.appreciation}>{signedMoney(holding.appreciation)}</Signed>}
        {holding.appreciation_pct === null ? '' : ` · ${percent(holding.appreciation_pct)}`}</Copy>
    </Row>
    <Copy muted>
      {holding.value === null ? 'Manual value unknown' : `${money(holding.value)} / unit · manual estimate`}
      {' · '}{holding.days_held === null ? 'Held age unknown' : `Held for ${days(holding.days_held)}`}
    </Copy>
  </>;
}

export function VaultDetails({ holding }: { holding: VaultHolding }) {
  const estimate = holding.market_estimate;
  return <Disclosure title="Valuation details">
    <Card>
      <Copy muted>Manual valuation · per-unit estimate, separate from cost and profit</Copy>
      {holding.value === null ? <Copy>Not valued yet</Copy> : <Row>
        <Metric label="Value per unit">{money(holding.value)}</Metric>
        <Metric label="Valued on">{holding.valued_on === null ? 'Date unavailable' : shortDate(holding.valued_on)}</Metric>
      </Row>}
      <Copy muted>{manualStatus(holding)}</Copy>
    </Card>
    <Card>
      <Copy muted>Market quote · separate from manual valuation and appreciation</Copy>
      {!estimate || estimate.value === null ? <Copy>Market quote unavailable</Copy> : <>
        <Metric label="Estimated value per unit">{money(estimate.value)}</Metric>
        <Row>
          <Metric label="Source">{estimate.provider || 'Unknown'}</Metric>
          <Metric label="Captured on">{estimate.captured_on === null ? 'No date' : shortDate(estimate.captured_on)}</Metric>
          <Metric label="Status">{estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1)}</Metric>
        </Row>
      </>}
    </Card>
    <Card>
      <Copy muted>Holding context</Copy>
      <Copy>{holding.days_in_store_first === null ? 'Store move history unavailable' : `Moved to Vault after ${days(holding.days_in_store_first)} in the Store`}</Copy>
      <Copy muted>Annualised appreciation: {holding.annualised === null ? 'Unknown' : percent(holding.annualised)}</Copy>
    </Card>
  </Disclosure>;
}
