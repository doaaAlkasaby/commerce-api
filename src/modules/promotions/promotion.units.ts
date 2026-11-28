export const stableCompare = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;

interface Edge {
  to: number;
  capacity: number;
  reverse: number;
}

/**
 * Capacitated bipartite matching. Residual edges allow a narrow selector to
 * reclaim units assigned to a broader selector. Each vertex represents a
 * line or a requirement, regardless of its physical unit count.
 */
export function allocateUnits(
  supplies: readonly number[],
  demands: readonly { quantity: number; matches: readonly number[] }[],
) {
  const demandOffset = supplies.length + 1;
  const sink = demandOffset + demands.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);

  function edge(from: number, to: number, capacity: number) {
    const forward = { to, capacity, reverse: graph[to]!.length };
    graph[to]!.push({ to: from, capacity: 0, reverse: graph[from]!.length });
    graph[from]!.push(forward);
    return forward;
  }

  supplies.forEach((quantity, index) => edge(0, index + 1, quantity));
  const assignments = demands.map(({ quantity, matches }, index) => {
    edge(demandOffset + index, sink, quantity);
    return matches.map((supply) => ({
      supply,
      edge: edge(
        supply + 1,
        demandOffset + index,
        Math.min(supplies[supply]!, quantity),
      ),
    }));
  });

  const previous = new Int32Array(graph.length);
  const visited = new Int32Array(graph.length);
  const queue = new Int32Array(graph.length);
  while (true) {
    previous.fill(-1);
    previous[0] = 0;
    queue[0] = 0;
    let tail = 1;
    for (let head = 0; head < tail && previous[sink] === -1; head++) {
      const node = queue[head]!;
      graph[node]!.forEach((arc, index) => {
        if (arc.capacity > 0 && previous[arc.to] === -1) {
          previous[arc.to] = node;
          visited[arc.to] = index;
          queue[tail++] = arc.to;
        }
      });
    }
    if (previous[sink] === -1) break;
    let amount = Number.MAX_SAFE_INTEGER;
    for (let node = sink; node !== 0; node = previous[node]!) {
      amount = Math.min(
        amount,
        graph[previous[node]!]![visited[node]!]!.capacity,
      );
    }
    for (let node = sink; node !== 0; node = previous[node]!) {
      const arc = graph[previous[node]!]![visited[node]!]!;
      arc.capacity -= amount;
      graph[node]![arc.reverse]!.capacity += amount;
    }
  }

  return assignments.map((entries, index) => {
    const units = entries.flatMap(({ supply, edge: arc }) => {
      const quantity = graph[arc.to]![arc.reverse]!.capacity;
      return quantity > 0 ? [{ supply, quantity }] : [];
    });
    return {
      units,
      missing:
        demands[index]!.quantity -
        units.reduce((sum, unit) => sum + unit.quantity, 0),
    };
  });
}
