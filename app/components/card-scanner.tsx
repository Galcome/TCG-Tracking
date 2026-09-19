import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useReducer, useRef, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useApi } from '../context/AppContext'
import { colors } from '../context/ThemeContext'
import { ApiError } from '../lib/transport'
import { photoBody } from '../lib/photo'
import { newCards, scanReducer, scanTotal, type ScanItem } from '../lib/scan-session'
import { Button, Choice, Copy, ErrorNotice, Field, Row, styles as ui } from './ui'

/** One frame this often. The server allows one a second per person; slower saves spend. */
const FRAME_INTERVAL_MS = 1200
/** Wide enough to read a card name and number, small enough to upload in a blink. */
const FRAME_WIDTH = 640

/** Live scanning needs a native camera; the web build keeps the photo picker. */
export const canLiveScan = Platform.OS !== 'web'

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The server's refusals that more frames will not fix. Anything else, keep scanning. */
function stopsScanning(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503 && /limit|No vision key/i.test(error.message)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export interface CardScannerProps {
  open: boolean
  gameId: string
  title: string
  doneLabel: string
  /** Direct stock entry asks for actual paid cost. Rip mode uses market value only as a weight. */
  costEntry?: boolean
  /** Whether every row needs a price before `onDone` (a purchase), or only a name (a rip). */
  validate: (items: ScanItem[]) => string | null
  /**
   * Take the cards. `settled` marks one as saved, so a failure halfway through leaves only
   * the rest to retry and nothing is written twice.
   */
  onDone: (items: ScanItem[], settled: (key: string) => void) => Promise<void> | void
  onClose: () => void
}

export function CardScanner({ open, gameId, title, doneLabel, costEntry = false, validate, onDone, onClose }: CardScannerProps) {
  const api = useApi()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const status = useQuery({ queryKey: ['visionStatus'], queryFn: api.visionStatus, enabled: open })
  const [items, dispatch] = useReducer(scanReducer, [])
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])
  const camera = useRef<CameraView>(null)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [stopped, setStopped] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)

  const scanning = open && ready && !paused && !stopped && !saving &&
    Boolean(permission?.granted) && status.data?.available === true

  function price(item: ScanItem) {
    void api.lookupCard({
      game_id: gameId,
      name: item.name,
      set_name: item.setName,
      ...(item.collectorNumber ? { collector_number: item.collectorNumber } : {}),
      ...(item.variant ? { variant: item.variant } : {}),
    }).then(
      (lookup) => dispatch({ type: 'priced', key: item.key, lookup }),
      (error: unknown) => dispatch({ type: 'failed', key: item.key, message: `${message(error)} Enter the price.` }),
    )
  }

  useEffect(() => {
    if (!scanning) return
    let cancelled = false

    async function readFrame() {
      const picture = await camera.current?.takePictureAsync({ quality: 0.7, shutterSound: false })
      if (!picture || cancelled) return
      const rendered = await ImageManipulator.manipulate(picture.uri).resize({ width: FRAME_WIDTH }).renderAsync()
      const frame = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG })
      if (cancelled) return
      const result = await api.readCards(photoBody({ uri: frame.uri, name: 'frame.jpg', type: 'image/jpeg' }))
      if (cancelled) return
      const fresh = newCards(itemsRef.current, result.cards)
      if (!fresh.length) return
      dispatch({ type: 'seen', cards: fresh })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setNotice(`Added ${fresh.map((card) => card.name).join(', ')}`)
      // The reducer has not run yet; the keys are the ones it will give these cards.
      for (const item of scanReducer([], { type: 'seen', cards: fresh })) price(item)
    }

    async function loop() {
      while (!cancelled) {
        const started = Date.now()
        try {
          await readFrame()
        } catch (error) {
          if (cancelled) return
          if (stopsScanning(error)) { setStopped(message(error)); return }
          // A blurry frame or a busy model: the next frame is the retry.
          setNotice(message(error))
        }
        await wait(Math.max(0, FRAME_INTERVAL_MS - (Date.now() - started)))
      }
    }

    void loop()
    return () => { cancelled = true }
    // price and api are stable for the life of the sheet; restarting on them would double-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  function close() {
    if (saving) return
    dispatch({ type: 'clear' })
    setNotice(null)
    setStopped(null)
    setPaused(false)
    setReady(false)
    setSaveError(null)
    onClose()
  }

  async function finish() {
    const problem = validate(items)
    if (problem) { setSaveError(new Error(problem)); return }
    setSaving(true)
    setSaveError(null)
    try {
      await onDone(items, (key) => dispatch({ type: 'remove', key }))
      close()
    } catch (error) {
      setSaveError(error)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  let cameraArea
  if (!permission) {
    cameraArea = <Copy muted>Checking camera permission…</Copy>
  } else if (!permission.granted) {
    cameraArea = <View style={{ gap: 10, padding: 16 }}>
      <Copy>The camera reads each card&apos;s name, set and number. Photos are not kept.</Copy>
      <Button variant="primary" label="Allow camera" onPress={() => { void requestPermission() }} />
    </View>
  } else {
    cameraArea = <CameraView
      ref={camera}
      style={{ flex: 1 }}
      facing="back"
      animateShutter={false}
      onCameraReady={() => setReady(true)}
    />
  }

  const statusLine = stopped
    ?? (status.data?.available === false ? 'Card reading is off. Type the cards in instead.' : null)
    ?? (paused ? 'Paused.' : notice ?? 'Hold one or more cards flat in view.')

  return <Modal visible animationType="slide" onRequestClose={close}>
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <Row>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700', flex: 1 }}>{title}</Text>
          <Button label={paused ? 'Resume' : 'Pause'} disabled={Boolean(stopped) || saving} onPress={() => setPaused((value) => !value)} />
          <Button label="Close" disabled={saving} onPress={close} />
        </Row>
      </View>
      <View style={{ height: '42%', backgroundColor: '#000', justifyContent: 'center' }}>{cameraArea}</View>
      <Text accessibilityLiveRegion="polite" style={{ color: stopped ? colors.loss : colors.muted, paddingHorizontal: 16, paddingVertical: 8 }}>
        {statusLine}
      </Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {items.map((item) => <ScanRow key={item.key} item={item} disabled={saving}
          costEntry={costEntry}
          onQuantity={(delta) => dispatch({ type: 'quantity', key: item.key, delta })}
          onPrice={(value) => dispatch({ type: 'price', key: item.key, price: value })}
          onPaid={(value) => dispatch({ type: 'paid', key: item.key, paidEach: value })}
          onIdentity={(field, value) => dispatch({ type: 'identity', key: item.key, field, value })}
          onListing={(index) => dispatch({ type: 'listing', key: item.key, index })}
          onReviewed={() => dispatch({ type: 'reviewed', key: item.key })}
          onRemove={() => dispatch({ type: 'remove', key: item.key })} />)}
        {!items.length ? <Copy muted>Cards appear here as they are read. Prices come from TCGplayer, in CAD.</Copy> : null}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderColor: colors.edge, paddingHorizontal: 16, paddingTop: 10, gap: 8 }}>
        {saveError ? <ErrorNotice error={saveError} /> : null}
        <Row>
          <Text style={{ color: colors.text, flex: 1, fontVariant: ['tabular-nums'] }}>
            {items.length} card{items.length === 1 ? '' : 's'} · ${scanTotal(items)} market
          </Text>
          <Button variant="primary" label={saving ? 'Saving…' : doneLabel} disabled={saving || !items.length} onPress={() => { void finish() }} />
        </Row>
      </View>
    </View>
  </Modal>
}

function ScanRow({ item, disabled, costEntry, onQuantity, onPrice, onPaid, onIdentity, onListing, onReviewed, onRemove }: {
  item: ScanItem
  disabled: boolean
  costEntry: boolean
  onQuantity: (delta: number) => void
  onPrice: (value: string) => void
  onPaid: (value: string) => void
  onIdentity: (field: 'name' | 'setName' | 'collectorNumber' | 'variant' | 'language', value: string) => void
  onListing: (index: number) => void
  onReviewed: () => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const detail = [item.setName, item.collectorNumber, item.variant].filter(Boolean).join(' · ')
  return <View style={[ui.card, { padding: 12, gap: 6 }]}>
    <Row>
      <View style={{ flex: 1, minWidth: 140 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{item.name}</Text>
        {detail ? <Text style={{ color: colors.muted, fontSize: 13 }}>{detail}</Text> : null}
      </View>
      <Stepper label="−" accessibilityLabel={`One fewer ${item.name}`} disabled={disabled} onPress={() => onQuantity(-1)} />
      <Text style={{ color: colors.text, minWidth: 20, textAlign: 'center' }}>{item.quantity}</Text>
      <Stepper label="+" accessibilityLabel={`One more ${item.name}`} disabled={disabled} onPress={() => onQuantity(1)} />
      <Button variant="link" label={editing ? 'Done editing' : 'Review'} disabled={disabled} onPress={() => setEditing((value) => !value)} />
    </Row>
    {item.status === 'pricing' ? <Text style={{ color: colors.muted, fontSize: 13 }}>Pricing…</Text> : null}
    {item.message ? <Text style={{ color: colors.muted, fontSize: 13 }}>{item.message}</Text> : null}
    <Text style={{ color: colors.muted, fontSize: 13 }}>
      Market estimate {item.price ? `$${item.price} CAD each` : 'unavailable'}
    </Text>
    {costEntry ? <Field
      label={`Paid each for ${item.name}`}
      value={item.paidEach}
      onChangeText={onPaid}
      editable={!disabled}
      keyboardType="decimal-pad"
      placeholder="0.00"
    /> : <Field
      label={`Allocation value for ${item.name}`}
      value={item.price}
      onChangeText={onPrice}
      editable={!disabled}
      keyboardType="decimal-pad"
      placeholder="0.00"
    />}
    {editing ? <View style={{ gap: 8 }}>
      {item.candidates.length ? <Choice
        label="Catalog match"
        value={String(item.candidates.findIndex((candidate) => candidate.listing.product_id === item.listing?.productId && candidate.subtype === item.listing?.subtype))}
        options={item.candidates.map((candidate, index) => ({
          value: String(index),
          label: `${candidate.listing.name}${candidate.listing.number ? ` #${candidate.listing.number}` : ''} · ${candidate.subtype}${candidate.market ? ` · $${candidate.market}` : ''}`,
        }))}
        onChange={(value) => onListing(Number(value))}
        disabled={disabled}
      /> : null}
      <Field label="Card name" value={item.name} onChangeText={(value) => onIdentity('name', value)} editable={!disabled} />
      <Field label="Set" value={item.setName} onChangeText={(value) => onIdentity('setName', value)} editable={!disabled} />
      <Row>
        <Field label="Collector number" value={item.collectorNumber} onChangeText={(value) => onIdentity('collectorNumber', value)} editable={!disabled} style={{ minWidth: 120 }} />
        <Field label="Printing" value={item.variant} onChangeText={(value) => onIdentity('variant', value)} editable={!disabled} style={{ minWidth: 120 }} />
      </Row>
      <Field label="Language" value={item.language} onChangeText={(value) => onIdentity('language', value)} editable={!disabled} />
    </View> : null}
    <Row>
      <Button variant={item.reviewed ? 'secondary' : 'primary'} label={item.reviewed ? 'Card confirmed' : 'Confirm card'} disabled={disabled || item.status === 'pricing'} onPress={onReviewed} />
      <Button variant="link" label="Remove" disabled={disabled} onPress={onRemove} />
    </Row>
  </View>
}

function Stepper({ label, accessibilityLabel, disabled, onPress }: {
  label: string; accessibilityLabel: string; disabled: boolean; onPress: () => void
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.button, { minHeight: 40, minWidth: 40, paddingHorizontal: 0, paddingVertical: 0, alignItems: 'center', opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <Text style={{ color: colors.text, fontSize: 18 }}>{label}</Text>
  </Pressable>
}
