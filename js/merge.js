// Pure sync logic: combine this device's data with the server's. No DOM or storage here.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of a list. `base` is what the server held last time, so we can tell "deleted" from "never had it". */
function mergeList(base, local, remote, id, pick) {
  const map = (l) => new Map((l || []).map((x) => [id(x), x]));
  const b = map(base), l = map(local), r = map(remote), out = [];
  for (const k of new Set([...r.keys(), ...l.keys()])) {
    const inL = l.has(k), inR = r.has(k);
    if (inL && inR) out.push(pick(b.get(k), l.get(k), r.get(k)));
    else if (!b.has(k)) out.push(inL ? l.get(k) : r.get(k));      // new on one side
    // otherwise it was deleted on the other side
  }
  return out;
}

function pickPosition(_, l, r) {
  if (l.closedAt && r.closedAt) return l.closedAt < r.closedAt ? l : r;
  if (l.closedAt || r.closedAt) return l.closedAt ? l : r;           // closing is final
  return l.lastAccrual > r.lastAccrual ? l : r;                      // fees are a running total: keep the newer one, never add them
}

function mergePaper(local, remote) {
  if (!remote) return local;
  const lr = local.resetAt || 0, rr = remote.resetAt || 0;
  const resetAt = Math.max(lr, rr), startBalance = (lr > rr ? local : remote).startBalance;
  const live = (p) => p.positions.filter((x) => x.openedAt >= resetAt);   // a reset wipes everything opened before it
  const positions = mergeList([], live(local), live(remote), (p) => p.id, pickPosition).sort((a, b) => a.openedAt - b.openedAt);
  // Cash follows from the positions, so two devices can never double-spend or double-refund it.
  const cash = positions.reduce((t, p) => t - p.capital + (p.closedAt ? p.closeValue : 0), startBalance);
  return { startBalance, cash, positions, ...(resetAt ? { resetAt } : {}) };
}

// A bot's settings never change; only stopping does, and that is final (the first stop wins).
function pickBot(_, l, r) {
  if (l.stoppedAt && r.stoppedAt) return l.stoppedAt < r.stoppedAt ? l : r;
  return l.stoppedAt ? l : r;
}
const mergeBots = (base, local, remote) => mergeList(base, local, remote, (b) => b.id, pickBot).sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? -1 : 1));
// The Mac and web write fields in a different order and the Mac leaves empty ones out: compare what they mean.
const plain = (list) => JSON.stringify((list || []).map((b) => Object.keys(b).sort().filter((k) => b[k] != null).map((k) => [k, b[k]])));

export const DOCS = {
  bots: { merge: mergeBots, same: (a, b) => plain(a) === plain(b) },
  wallets: {
    merge: (base, local, remote) => mergeList(base, local, remote, (w) => w.address.toLowerCase(), (b, l, r) => (b && same(b, l) ? r : l)),
    same,
  },
  watched: {
    merge: (base, local, remote) => mergeList(base, local, remote, (p) => p.id, (_, l) => l),
    // Pool figures refresh constantly; only a change in which pools are tracked is worth uploading.
    same: (a, b) => same((a || []).map((p) => p.id).sort(), (b || []).map((p) => p.id).sort()),
  },
  paper: { merge: (_, local, remote) => mergePaper(local, remote), same },
};

/**
 * One sync pass. io = { get(key), set(key, value), base (object, updated in place), pull(), push(key, value, version) → status }.
 * Returns 'ok', or 'retry' if another device wrote at the same moment.
 */
export async function syncDocs(io, remote) {
  let result = 'ok';
  for (const [key, doc] of Object.entries(DOCS)) {
    const server = remote.docs[key];
    const local = io.get(key);                                       // read, merge and write back with no await in between
    const merged = doc.merge(io.base[key], local, server?.value);
    if (!same(merged, local)) io.set(key, JSON.parse(JSON.stringify(merged)));   // a copy: the app edits objects in place
    if (server) io.base[key] = server.value; else delete io.base[key];
    if (server && doc.same(merged, server.value)) continue;
    const status = await io.push(key, merged, server?.version ?? 0);
    if (status === 200) io.base[key] = JSON.parse(JSON.stringify(merged));
    else if (status === 409) result = 'retry';
    else throw new Error(`sync failed (${status})`);
  }
  return result;
}
