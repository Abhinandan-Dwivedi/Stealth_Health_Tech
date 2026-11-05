import { Hono } from 'hono'
import { cors } from 'hono/cors'

type EnvWithDB = {
  Bindings: Env
}

type MemberRow = {
  id: string
  home_id: string
  name: string
  created_at: number
}

type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

const app = new Hono<EnvWithDB>()

app.use('*', cors())

app.onError((err, c) => {
  return c.json({ error: err.message || 'Internal Server Error' }, 500)
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// List all homes
app.get('/api/homes', async (c) => {
  const result = await c.env.DB.prepare('SELECT id, name FROM homes ORDER BY created_at ASC').all<{
    id: string
    name: string
  }>()
  return c.json({ homes: result.results })
})

// Create a home
app.post('/api/homes', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const createdAt = Date.now()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, createdAt)
    .run()

  return c.json({ id, name }, 201)
})

// Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const createdAt = Date.now()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, createdAt)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// Get members of a home
app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, name FROM members WHERE home_id = ? ORDER BY created_at ASC, rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string }>()

  return c.json({ members: members.results })
})

// Create a bill in a home
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json().catch(() => null)
  if (
    !body ||
    typeof body.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'totalCents must be a positive integer' }, 422)
  }

  if (typeof body.title !== 'string' || body.title.trim() === '') {
    return c.json({ error: 'Title is required' }, 422)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY created_at ASC, rowid ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  if (!members.results || members.results.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const memberCount = members.results.length
  const totalCents = body.totalCents
  const baseShare = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const billId = crypto.randomUUID()
  const title = body.title.trim()
  const createdAt = Date.now()

  const shares = members.results.map((member, index) => {
    const amountCents = baseShare + (index < remainder ? 1 : 0)
    return {
      id: crypto.randomUUID(),
      billId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    }
  })

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents, createdAt),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key) VALUES (?, ?, ?, ?, NULL, NULL)',
      ).bind(share.id, share.billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares: shares.map((s) => ({
        id: s.id,
        memberId: s.memberId,
        amountCents: s.amountCents,
        paidAt: null,
      })),
    },
    201,
  )
})

// List bills for a home (with shares)
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const bills = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, title, total_cents as totalCents, created_at FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number; created_at: number }>()

  const shares = await c.env.DB.prepare(
    `SELECT s.id, s.bill_id as billId, s.member_id as memberId, m.name as memberName, s.amount_cents as amountCents, s.paid_at as paidAt
     FROM shares s
     JOIN bills b ON b.id = s.bill_id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?
     ORDER BY s.rowid ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>()

  const sharesByBill = new Map<string, typeof shares.results>()
  for (const share of shares.results) {
    const list = sharesByBill.get(share.billId) ?? []
    list.push(share)
    sharesByBill.set(share.billId, list)
  }

  const result = bills.results.map((bill) => ({
    ...bill,
    shares: sharesByBill.get(bill.id) ?? [],
  }))

  return c.json({ bills: result })
})

// Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const idempotencyKey = c.req.header('Idempotency-Key')
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // If already marked as paid
  if (share.paid_at !== null) {
    if (share.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  // Attempt atomic update
  const now = new Date().toISOString()
  const updateResult = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(now, idempotencyKey, shareId, billId)
    .run()

  if (updateResult.meta.changes > 0) {
    return c.json(
      {
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: now,
      },
      200,
    )
  }

  // If update had 0 changes, a concurrent request must have paid it
  const current = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (current && current.idempotency_key === idempotencyKey) {
    return c.json(
      {
        id: current.id,
        memberId: current.member_id,
        amountCents: current.amount_cents,
        paidAt: current.paid_at,
      },
      200,
    )
  }

  return c.json({ error: 'Share already paid with a different key' }, 409)
})

// Balances of members in a home
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const balances = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(SUM(CASE WHEN s.paid_at IS NULL AND s.id IS NOT NULL THEN s.amount_cents ELSE 0 END), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name
     ORDER BY m.created_at ASC, m.rowid ASC`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: balances.results }, 200)
})

export default app
