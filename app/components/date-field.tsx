import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTypography } from '../context/TypographyContext';
import { dateFromIso, describeDate, isoFromDate, todayIso, yesterdayIso } from '../lib/format';
import { Button, Row, styles } from './ui';

export type DateFieldProps = { label: string; value: string; onChange: (value: string) => void; disabled?: boolean };

/** A calendar day, defaulting to whatever the form seeded (usually today). One tap for the
 * common back-dates; the native calendar for anything older. Future days can't be picked. */
export function DateField({ label, value, onChange, disabled = false }: DateFieldProps) {
  const fonts = useTypography();
  const [open, setOpen] = useState(false);
  const pick = (event: DateTimePickerEvent, date?: Date) => {
    setOpen(false);
    if (event.type === 'set' && date) onChange(isoFromDate(date));
  };
  return <View style={styles.field}><Text style={[styles.label, { fontFamily: fonts.medium }]}>{label}</Text>
    <Row>
      <Button label={describeDate(value)} disabled={disabled} onPress={() => setOpen(true)} />
      {value !== todayIso() ? <Button variant="link" label="Today" disabled={disabled} onPress={() => onChange(todayIso())} /> : null}
      {value !== yesterdayIso() ? <Button variant="link" label="Yesterday" disabled={disabled} onPress={() => onChange(yesterdayIso())} /> : null}
    </Row>
    {open ? <DateTimePicker value={dateFromIso(value) ?? new Date()} mode="date" maximumDate={new Date()}
      display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={pick} /> : null}
  </View>;
}
