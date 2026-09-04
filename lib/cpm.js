function calculateCPM(tasks, deps) {
  const taskMap = new Map(tasks.map(t => [t.id, {
    ...t, duration: Math.max(1, t.duration_days || 1),
    es: 0, ef: 0, ls: Infinity, lf: Infinity,
    predecessors: [], successors: [],
  }]));

  for (const d of deps) {
    const pred = taskMap.get(d.predecessor_id);
    const succ = taskMap.get(d.successor_id);
    if (!pred || !succ) continue; // dependency references a task outside this project — ignore
    pred.successors.push({ id: d.successor_id, type: d.type || 'FS', lag: d.lag_days || 0 });
    succ.predecessors.push({ id: d.predecessor_id, type: d.type || 'FS', lag: d.lag_days || 0 });
  }

  // Kahn's algorithm — topological sort + cycle detection
  const inDegree = new Map();
  taskMap.forEach((t, id) => inDegree.set(id, t.predecessors.length));
  const queue = [...taskMap.keys()].filter(id => inDegree.get(id) === 0);
  const order = [];
  const inDegreeWork = new Map(inDegree);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    taskMap.get(id).successors.forEach(s => {
      inDegreeWork.set(s.id, inDegreeWork.get(s.id) - 1);
      if (inDegreeWork.get(s.id) === 0) queue.push(s.id);
    });
  }
  if (order.length !== taskMap.size) {
    return { error: 'circular_dependency' };
  }

  // Forward pass — earliest start/finish
  const esConstraint = (t, p) => {
    const P = taskMap.get(p.id);
    if (p.type === 'SS') return P.es + p.lag;
    if (p.type === 'FF') return P.ef + p.lag - t.duration;
    if (p.type === 'SF') return P.es + p.lag - t.duration;
    return P.ef + p.lag; // FS (default)
  };
  order.forEach(id => {
    const t = taskMap.get(id);
    t.es = t.predecessors.length ? Math.max(...t.predecessors.map(p => esConstraint(t, p))) : 0;
    t.ef = t.es + t.duration;
  });

  const projectDuration = Math.max(0, ...[...taskMap.values()].map(t => t.ef));

  // Backward pass — latest start/finish
  const lfConstraint = (t, s) => {
    const S = taskMap.get(s.id);
    if (s.type === 'SS') return S.ls - s.lag + t.duration;
    if (s.type === 'FF') return S.lf - s.lag;
    if (s.type === 'SF') return S.lf - s.lag + t.duration;
    return S.ls - s.lag; // FS (default)
  };
  [...order].reverse().forEach(id => {
    const t = taskMap.get(id);
    t.lf = t.successors.length ? Math.min(...t.successors.map(s => lfConstraint(t, s))) : projectDuration;
    t.ls = t.lf - t.duration;
  });

  const results = [...taskMap.values()].map(t => ({
    id: t.id,
    es: t.es, ef: t.ef, ls: t.ls, lf: t.lf,
    float: Math.round((t.ls - t.es) * 100) / 100,
    is_critical: Math.round((t.ls - t.es) * 100) / 100 === 0,
  }));

  return { results, projectDuration };
}

module.exports = { calculateCPM };
