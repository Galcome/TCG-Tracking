import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useApi } from '../context/AppContext';
import { type GradingSubmission, type ProductDetail, type Transformation } from '../lib/api';
import { money } from '../lib/format';
import { gradingAvailable } from '../lib/grading-drafts';
import { canCrack, canRip } from '../lib/product-types';
import { CrackCaseDialog } from './crack-form';
import { EditGradingDialog, SendToGradingDialog, ReturnFromGradingDialog, VoidGradingDialog } from './grading-forms';
import { RipDialog } from './rip-form';
import { Button, Card, Copy, ErrorNotice, Field, Heading, Loading, Row, Sheet } from './ui';

function VoidTransformationDialog({ transformation, onClose }: { transformation: Transformation; onClose: () => void }) {
  const api = useApi();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('An audit reason is required.');
      return api.voidTransformation(transformation.id, reason.trim());
    },
    onSuccess: async () => { await client.invalidateQueries(); onClose(); },
  });
  return <Sheet title={'Undo ' + transformation.kind} open onClose={onClose} dismissDisabled={mutation.isPending}>
    <Copy>This reverses the source and its outputs together. The server will refuse a reversal if later transactions depend on it.</Copy>
    <Field label="Reason" value={reason} onChangeText={setReason} editable={!mutation.isPending} />
    <ErrorNotice error={mutation.error} />
    <Button label="Undo transformation" danger disabled={mutation.isPending || !reason.trim()} onPress={() => mutation.mutate()} />
  </Sheet>;
}

/**
 * Correct a rip or a crack. The form needs the product that was opened, which is not the
 * page's product when the record is being looked at from one of the things that came out.
 */
function CorrectTransformationDialog({ transformation, product, onClose }: { transformation: Transformation; product: ProductDetail; onClose: () => void }) {
  const api = useApi();
  const own = transformation.source_product_id === product.id;
  const source = useQuery({ queryKey: ['product', transformation.source_product_id], queryFn: () => api.product(transformation.source_product_id), enabled: !own });
  const opened = own ? product : source.data;
  if (!opened) return <Sheet title={'Edit ' + transformation.kind} open onClose={onClose}>
    <ErrorNotice error={source.error} retry={() => { void source.refetch(); }} />
    {source.isPending && <Loading />}
  </Sheet>;
  return transformation.kind === 'rip'
    ? <RipDialog key={transformation.id} product={opened} editing={transformation} onClose={onClose} />
    : <CrackCaseDialog key={transformation.id} product={opened} editing={transformation} onClose={onClose} />;
}

/** All costs and inherited dates shown here come from the ledger, not client estimates. */
export function ProductOperations({ product }: { product: ProductDetail }) {
  const api = useApi();
  const [action, setAction] = useState<'crack' | 'rip' | 'send' | null>(null);
  const [returning, setReturning] = useState<GradingSubmission | null>(null);
  const [voiding, setVoiding] = useState<GradingSubmission | null>(null);
  const [undoing, setUndoing] = useState<Transformation | null>(null);
  const [editingSubmission, setEditingSubmission] = useState<GradingSubmission | null>(null);
  const [correcting, setCorrecting] = useState<Transformation | null>(null);
  const grading = useQuery({ queryKey: ['grading', product.id], queryFn: () => api.gradingSubmissions({ product_id: product.id }) });
  const transformations = useQuery({ queryKey: ['transformations', product.id], queryFn: () => api.transformations({ product_id: product.id }) });
  const inStock = product.stats.quantity_on_hand > 0;
  const availableForGrading = grading.isSuccess && Object.values(gradingAvailable(product.id, product.stats.by_bucket, grading.data)).some(count => count > 0);
  return <>
    <Row>
      {canCrack(product.product_type.slug) && <Button label="Crack open" disabled={!inStock} onPress={() => setAction('crack')} />}
      {canRip(product.product_type.slug) && <Button label="Rip open" disabled={!inStock} onPress={() => setAction('rip')} />}
      <Button label="Send to grading" disabled={!availableForGrading} onPress={() => setAction('send')} />
    </Row>
    {action === 'crack' && <CrackCaseDialog product={product} onClose={() => setAction(null)} />}
    {action === 'rip' && <RipDialog product={product} onClose={() => setAction(null)} />}
    {action === 'send' && <SendToGradingDialog product={product} onClose={() => setAction(null)} />}
    {returning && <ReturnFromGradingDialog product={product} submission={returning} onClose={() => setReturning(null)} />}
    {voiding && <VoidGradingDialog submission={voiding} onClose={() => setVoiding(null)} />}
    {undoing && <VoidTransformationDialog transformation={undoing} onClose={() => setUndoing(null)} />}
    {editingSubmission && <EditGradingDialog product={product} submission={editingSubmission} onClose={() => setEditingSubmission(null)} />}
    {correcting && <CorrectTransformationDialog transformation={correcting} product={product} onClose={() => setCorrecting(null)} />}
    <Heading>Grading history</Heading>
    <ErrorNotice error={grading.error} retry={() => { void grading.refetch(); }} />
    {grading.isPending && <Loading />}
    {grading.data?.length === 0 && <Copy muted>No grading submissions.</Copy>}
    {grading.data?.map(submission => <View key={submission.id} role="group" accessibilityLabel={'Grading ' + submission.id}><Card>
      <Copy>{submission.quantity} at {submission.grading_company ?? 'grader'} · {submission.status} · {submission.days_out} days</Copy>
      <Copy>Sent {submission.sent_on} · Fees {money(submission.fees)} · {submission.bucket}</Copy>
      {submission.returned_on && <Copy>Returned {submission.returned_on} · Grade {submission.grade ?? 'not recorded'}</Copy>}
      <Copy muted>{submission.notes}</Copy>
      {submission.status === 'out' && <Row>
        <Button label="Record grading return" onPress={() => setReturning(submission)} />
        <Button label="Edit" onPress={() => setEditingSubmission(submission)} />
        <Button label="Void grading submission" danger onPress={() => setVoiding(submission)} />
      </Row>}
      {submission.status === 'returned' && <Button label="Edit" onPress={() => setEditingSubmission(submission)} />}
    </Card></View>)}
    <Heading>Opened and graded</Heading>
    <ErrorNotice error={transformations.error} retry={() => { void transformations.refetch(); }} />
    {transformations.isPending && <Loading />}
    {transformations.data?.length === 0 && <Copy muted>No transformations.</Copy>}
    {transformations.data?.map(t => <View key={t.id} role="group" accessibilityLabel={'Transformation ' + t.id}><Card>
      <Copy>{t.kind} · {t.status} · {t.occurred_on ?? 'No date'}</Copy>
      <Button label={'Source: ' + t.source_product_name} onPress={() => router.push(`/products/${t.source_product_id}`)} />
      <Copy>{t.source_quantity} from {t.source_bucket} · Source cost {money(t.source_cost)}</Copy>
      <Copy>Inherited purchase date {t.inherited_purchase_date ?? 'unknown'} · Bulk write-off {money(t.bulk_cost)}</Copy>
      {t.outputs.map((output, index) => <View key={output.product_id + output.bucket + index}>
        <Button label={'Output: ' + output.product_name} onPress={() => router.push(`/products/${output.product_id}`)} />
        <Copy>{output.quantity} in {output.bucket} · Allocated cost {money(output.cost)}</Copy>
      </View>)}
      <Copy muted>{t.notes}</Copy>
      {t.status === 'active' && <Row>
        {t.kind !== 'grade' && <Button label={'Edit ' + t.kind} onPress={() => setCorrecting(t)} />}
        <Button label={t.kind === 'grade' ? 'Undo return' : 'Undo ' + t.kind} danger onPress={() => setUndoing(t)} />
      </Row>}
    </Card></View>)}
  </>;
}
