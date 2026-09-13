import type { LineageNode, LineageRollup } from './api'
import { compareDecimalStrings } from './reports'

/** Descendants, sales, and no-hit write-offs all carry a lineage story. */
export function lineageHasActivity(report: Pick<LineageRollup, 'tree' | 'units_sold' | 'written_off'>): boolean {
  return report.tree.length > 0 || report.units_sold > 0 || compareDecimalStrings(report.written_off, '0.00') !== 0
}

export function lineageNodeLabel(node: Pick<LineageNode, 'product_name'>): string {
  return `Lineage node: ${node.product_name}`
}

/** Flatten the server tree in preorder while retaining each node's depth for display. */
export function flattenLineageNodes(nodes: LineageNode[]): LineageNode[] {
  const flattened: LineageNode[] = []
  const visit = (children: LineageNode[]) => {
    for (const node of children) {
      flattened.push(node)
      visit(node.children)
    }
  }
  visit(nodes)
  return flattened
}

/** Keep malformed/negative depths from creating a negative indentation on the web. */
export function lineageIndent(depth: number): number {
  return Math.min(2, Math.max(0, depth - 1)) * 14
}
