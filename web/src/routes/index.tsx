import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

interface Home {
  id: string
  name: string
}

interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}

interface Share {
  id: string
  billId: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  created_at: number
  shares: Share[]
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(isoString: string | null | number): string {
  if (!isoString) return ''
  const date = typeof isoString === 'number' ? new Date(isoString) : new Date(isoString)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function BillSplitterApp() {
  const [homes, setHomes] = useState<Home[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [balances, setBalances] = useState<Balance[]>([])
  const [bills, setBills] = useState<Bill[]>([])

  const [loadingHomes, setLoadingHomes] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  // Forms
  const [newHomeName, setNewHomeName] = useState('')
  const [creatingHome, setCreatingHome] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [billTitle, setBillTitle] = useState('')
  const [billAmountCents, setBillAmountCents] = useState('')
  const [creatingBill, setCreatingBill] = useState(false)
  const [billFormError, setBillFormError] = useState<string | null>(null)

  // Payment states keyed by shareId
  const [paymentStates, setPaymentStates] = useState<
    Record<string, { loading: boolean; error: string | null }>
  >({})

  // Fetch homes
  const fetchHomes = useCallback(async () => {
    try {
      setLoadingHomes(true)
      setGlobalError(null)
      const res = await fetch('/api/homes')
      if (!res.ok) {
        if (res.status === 502 || res.status === 504) {
          throw new Error(
            'API server is starting up or not running on http://127.0.0.1:8787 (HTTP 502).',
          )
        }
        throw new Error(`Failed to fetch homes: HTTP ${res.status}`)
      }
      const data = (await res.json()) as { homes: Home[] }
      setHomes(data.homes || [])
      if (data.homes && data.homes.length > 0 && !selectedHomeId) {
        setSelectedHomeId(data.homes[0]?.id || '')
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Unable to connect to API.')
    } finally {
      setLoadingHomes(false)
    }
  }, [selectedHomeId])

  // Fetch home details (balances and bills)
  const fetchHomeDetails = useCallback(async (homeId: string) => {
    if (!homeId) {
      setBalances([])
      setBills([])
      return
    }
    try {
      setLoadingDetails(true)
      setGlobalError(null)

      const [balancesRes, billsRes] = await Promise.all([
        fetch(`/api/homes/${homeId}/balances`),
        fetch(`/api/homes/${homeId}/bills`),
      ])

      if (!balancesRes.ok) {
        const errJson = await balancesRes.json().catch(() => ({}))
        throw new Error(errJson.error || `Failed to fetch balances: HTTP ${balancesRes.status}`)
      }
      if (!billsRes.ok) {
        const errJson = await billsRes.json().catch(() => ({}))
        throw new Error(errJson.error || `Failed to fetch bills: HTTP ${billsRes.status}`)
      }

      const balancesData = (await balancesRes.json()) as { balances: Balance[] }
      const billsData = (await billsRes.json()) as { bills: Bill[] }

      setBalances(balancesData.balances || [])
      setBills(billsData.bills || [])
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to load home details.')
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  useEffect(() => {
    fetchHomes()
  }, [fetchHomes])

  useEffect(() => {
    if (selectedHomeId) {
      fetchHomeDetails(selectedHomeId)
    }
  }, [selectedHomeId, fetchHomeDetails])

  // Create Home
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return
    try {
      setCreatingHome(true)
      setGlobalError(null)
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to create home')
      }
      const created = (await res.json()) as Home
      setNewHomeName('')
      setHomes((prev) => [...prev, created])
      setSelectedHomeId(created.id)
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Error creating home')
    } finally {
      setCreatingHome(false)
    }
  }

  // Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemberName.trim() || !selectedHomeId) return
    try {
      setAddingMember(true)
      setGlobalError(null)
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to add member')
      }
      setNewMemberName('')
      await fetchHomeDetails(selectedHomeId)
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Error adding member')
    } finally {
      setAddingMember(false)
    }
  }

  // Create Bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    setBillFormError(null)
    if (!selectedHomeId) return

    const parsedCents = Number(billAmountCents)
    if (!billTitle.trim()) {
      setBillFormError('Bill title is required.')
      return
    }
    if (!Number.isInteger(parsedCents) || parsedCents <= 0) {
      setBillFormError('Amount must be a positive integer in cents (e.g. 1000 for $10.00).')
      return
    }
    if (balances.length === 0) {
      setBillFormError('Cannot split a bill with 0 members. Please add members first.')
      return
    }

    try {
      setCreatingBill(true)
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: billTitle.trim(),
          totalCents: parsedCents,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status}: Failed to create bill`)
      }

      setBillTitle('')
      setBillAmountCents('')
      await fetchHomeDetails(selectedHomeId)
    } catch (err) {
      setBillFormError(err instanceof Error ? err.message : 'Error creating bill')
    } finally {
      setCreatingBill(false)
    }
  }

  // Pay Share
  const handlePayShare = async (billId: string, shareId: string) => {
    const idempotencyKey = crypto.randomUUID()
    setPaymentStates((prev) => ({
      ...prev,
      [shareId]: { loading: true, error: null },
    }))

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Payment failed (Status ${res.status})`)
      }

      const updatedShare = (await res.json()) as { paidAt: string }

      // Update bill share in place
      setBills((prevBills) =>
        prevBills.map((b) => {
          if (b.id !== billId) return b
          return {
            ...b,
            shares: b.shares.map((s) =>
              s.id === shareId ? { ...s, paidAt: updatedShare.paidAt } : s,
            ),
          }
        }),
      )

      // Refresh balances in background
      if (selectedHomeId) {
        fetch(`/api/homes/${selectedHomeId}/balances`)
          .then((r) => r.json())
          .then((data: { balances?: Balance[] }) => {
            if (data.balances) setBalances(data.balances)
          })
          .catch(() => {})
      }

      setPaymentStates((prev) => ({
        ...prev,
        [shareId]: { loading: false, error: null },
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      // Share remains unpaid, error is explicitly presented
      setPaymentStates((prev) => ({
        ...prev,
        [shareId]: { loading: false, error: msg },
      }))
    }
  }

  const selectedHome = homes.find((h) => h.id === selectedHomeId)

  return (
    <div
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '24px 16px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#1e293b',
        backgroundColor: '#f8fafc',
        minHeight: '100vh',
      }}
    >
      {/* App Header */}
      <header
        style={{
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: 20,
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              margin: '0 0 4px 0',
              color: '#0f172a',
            }}
          >
            Shared Bill Splitter
          </h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.95rem' }}>
            Even & fair expense sharing for shared homes
          </p>
        </div>

        {/* Home Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label
            htmlFor="home-select"
            style={{ fontWeight: 600, fontSize: '0.9rem', color: '#475569' }}
          >
            Home:
          </label>
          <select
            id="home-select"
            value={selectedHomeId}
            onChange={(e) => setSelectedHomeId(e.target.value)}
            disabled={loadingHomes || homes.length === 0}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '0.95rem',
              fontWeight: 500,
              minWidth: 160,
            }}
          >
            {homes.length === 0 ? (
              <option value="">No homes yet</option>
            ) : (
              homes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))
            )}
          </select>
        </div>
      </header>

      {/* Global Error Alert Banner */}
      {globalError && (
        <div
          role="alert"
          style={{
            backgroundColor: '#fee2e2',
            border: '1px solid #f87171',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: '#991b1b',
          }}
        >
          <div>
            <strong>Error:</strong> {globalError}
          </div>
          <button
            type="button"
            onClick={() => {
              if (selectedHomeId) fetchHomeDetails(selectedHomeId)
              else fetchHomes()
            }}
            style={{
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Quick Home Creation Section */}
      <section
        style={{
          background: '#ffffff',
          borderRadius: 10,
          padding: '16px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          marginBottom: 24,
          border: '1px solid #e2e8f0',
        }}
      >
        <form
          onSubmit={handleCreateHome}
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#334155' }}>
            Create New Home:
          </span>
          <input
            type="text"
            placeholder="e.g. Flat 4B, Pinecrest House"
            value={newHomeName}
            onChange={(e) => setNewHomeName(e.target.value)}
            disabled={creatingHome}
            style={{
              flex: '1 1 200px',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: '0.9rem',
            }}
          />
          <button
            type="submit"
            disabled={creatingHome || !newHomeName.trim()}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#2563eb',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: creatingHome || !newHomeName.trim() ? 'not-allowed' : 'pointer',
              opacity: creatingHome || !newHomeName.trim() ? 0.6 : 1,
            }}
          >
            {creatingHome ? 'Creating...' : '+ Create Home'}
          </button>
        </form>
      </section>

      {/* Main Content Area */}
      {loadingHomes ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748b' }}>
          <p style={{ fontSize: '1.1rem' }}>Loading homes...</p>
        </div>
      ) : homes.length === 0 ? (
        /* Empty State: No Homes */
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: 48,
            textAlign: 'center',
            border: '2px dashed #cbd5e1',
          }}
        >
          <h2 style={{ fontSize: '1.3rem', margin: '0 0 8px 0', color: '#334155' }}>
            No homes found
          </h2>
          <p style={{ color: '#64748b', margin: '0 0 20px 0' }}>
            Create your first shared home using the form above to begin adding members and splitting
            bills.
          </p>
        </div>
      ) : (
        <div>
          {/* Members & Balances Card */}
          <section
            style={{
              background: '#ffffff',
              borderRadius: 10,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              marginBottom: 24,
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: 16,
                gap: 12,
              }}
            >
              <div>
                <h2
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    margin: '0 0 4px 0',
                    color: '#0f172a',
                  }}
                >
                  {selectedHome?.name} — Members & Balances
                </h2>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Ordered by addition order (used for remainder cent allocation)
                </span>
              </div>

              {/* Add Member Form */}
              <form
                onSubmit={handleAddMember}
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <input
                  type="text"
                  placeholder="Member Name (e.g. Asha)"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  disabled={addingMember}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                  }}
                />
                <button
                  type="submit"
                  disabled={addingMember || !newMemberName.trim()}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#059669',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    cursor: addingMember || !newMemberName.trim() ? 'not-allowed' : 'pointer',
                    opacity: addingMember || !newMemberName.trim() ? 0.6 : 1,
                  }}
                >
                  {addingMember ? 'Adding...' : '+ Add Member'}
                </button>
              </form>
            </div>

            {loadingDetails ? (
              <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading balances...</p>
            ) : balances.length === 0 ? (
              /* Empty State: No Members */
              <div
                style={{
                  background: '#f1f5f9',
                  borderRadius: 8,
                  padding: 20,
                  textAlign: 'center',
                  color: '#475569',
                }}
              >
                <p style={{ margin: 0, fontWeight: 500 }}>
                  This home has no members yet. Add at least one member to split bills!
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 12,
                }}
              >
                {balances.map((balance, idx) => (
                  <div
                    key={balance.memberId}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>
                        #{idx + 1} {balance.name}
                      </span>
                      {balance.outstandingCents === 0 ? (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: '#dcfce7',
                            color: '#166534',
                            fontWeight: 600,
                          }}
                        >
                          Settled
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: '#fef3c7',
                            color: '#92400e',
                            fontWeight: 600,
                          }}
                        >
                          Owes
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                      {formatCents(balance.outstandingCents)}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      outstanding balance
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Create Bill Form Section */}
          <section
            style={{
              background: '#ffffff',
              borderRadius: 10,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              marginBottom: 24,
              border: '1px solid #e2e8f0',
            }}
          >
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                margin: '0 0 12px 0',
                color: '#0f172a',
              }}
            >
              Split a New Bill
            </h2>

            {billFormError && (
              <div
                style={{
                  backgroundColor: '#fee2e2',
                  border: '1px solid #f87171',
                  borderRadius: 6,
                  padding: '8px 12px',
                  marginBottom: 16,
                  color: '#991b1b',
                  fontSize: '0.9rem',
                }}
              >
                {billFormError}
              </div>
            )}

            <form
              onSubmit={handleCreateBill}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 120px',
                gap: 12,
                alignItems: 'end',
              }}
            >
              <div>
                <label
                  htmlFor="bill-title-input"
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    marginBottom: 4,
                    color: '#475569',
                  }}
                >
                  Bill Title
                </label>
                <input
                  id="bill-title-input"
                  type="text"
                  placeholder="e.g. WiFi, Groceries, Electricity"
                  value={billTitle}
                  onChange={(e) => setBillTitle(e.target.value)}
                  disabled={creatingBill}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="bill-cents-input"
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    marginBottom: 4,
                    color: '#475569',
                  }}
                >
                  Total Cents (Whole Integer)
                </label>
                <input
                  id="bill-cents-input"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 1000 for $10.00"
                  value={billAmountCents}
                  onChange={(e) => setBillAmountCents(e.target.value)}
                  disabled={creatingBill}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={creatingBill || !billTitle.trim() || !billAmountCents}
                style={{
                  height: 38,
                  borderRadius: 6,
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor:
                    creatingBill || !billTitle.trim() || !billAmountCents
                      ? 'not-allowed'
                      : 'pointer',
                  opacity: creatingBill || !billTitle.trim() || !billAmountCents ? 0.6 : 1,
                }}
              >
                {creatingBill ? 'Splitting...' : 'Split Bill'}
              </button>
            </form>
          </section>

          {/* Bills & Shares Section */}
          <section>
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                margin: '0 0 16px 0',
                color: '#0f172a',
              }}
            >
              Bills & Shares
            </h2>

            {loadingDetails ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748b' }}>
                <p>Loading bills...</p>
              </div>
            ) : bills.length === 0 ? (
              /* Empty State: No Bills */
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 10,
                  padding: 36,
                  textAlign: 'center',
                  border: '1px solid #e2e8f0',
                  color: '#64748b',
                }}
              >
                <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#334155' }}>
                  No bills recorded yet.
                </p>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>
                  Add a bill above to split it among all members of {selectedHome?.name}.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {bills.map((bill) => {
                  const paidCount = bill.shares.filter((s) => s.paidAt !== null).length
                  const totalShares = bill.shares.length
                  const isFullyPaid = paidCount === totalShares && totalShares > 0

                  return (
                    <div
                      key={bill.id}
                      style={{
                        background: '#ffffff',
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        overflow: 'hidden',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      }}
                    >
                      {/* Bill Header */}
                      <div
                        style={{
                          padding: '14px 18px',
                          background: '#f8fafc',
                          borderBottom: '1px solid #e2e8f0',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <h3
                              style={{
                                margin: 0,
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                color: '#0f172a',
                              }}
                            >
                              {bill.title}
                            </h3>
                            <span
                              style={{
                                fontSize: '0.78rem',
                                padding: '2px 8px',
                                borderRadius: 12,
                                background: isFullyPaid ? '#dcfce7' : '#e0f2fe',
                                color: isFullyPaid ? '#166534' : '#0369a1',
                                fontWeight: 600,
                              }}
                            >
                              {isFullyPaid
                                ? 'Fully Paid'
                                : `${paidCount} / ${totalShares} Shares Paid`}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            Added {formatDate(bill.created_at)}
                          </span>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              fontSize: '1.15rem',
                              fontWeight: 700,
                              color: '#0f172a',
                              display: 'block',
                            }}
                          >
                            {formatCents(bill.totalCents)}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            {bill.totalCents} cents total
                          </span>
                        </div>
                      </div>

                      {/* Shares Table / List */}
                      <div style={{ padding: '8px 18px' }}>
                        {bill.shares.map((share) => {
                          const state = paymentStates[share.id] || {
                            loading: false,
                            error: null,
                          }
                          const isPaid = share.paidAt !== null

                          return (
                            <div
                              key={share.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 0',
                                borderBottom: '1px solid #f1f5f9',
                                flexWrap: 'wrap',
                                gap: 8,
                              }}
                            >
                              <div>
                                <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                  {share.memberName || 'Member'}
                                </span>
                                <span
                                  style={{
                                    marginLeft: 12,
                                    fontSize: '0.95rem',
                                    fontWeight: 700,
                                    color: '#334155',
                                  }}
                                >
                                  {formatCents(share.amountCents)}
                                </span>
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontSize: '0.78rem',
                                    color: '#94a3b8',
                                  }}
                                >
                                  ({share.amountCents}¢)
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {isPaid ? (
                                  <div style={{ textAlign: 'right' }}>
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        fontSize: '0.82rem',
                                        fontWeight: 600,
                                        color: '#166534',
                                        background: '#dcfce7',
                                        padding: '4px 10px',
                                        borderRadius: 6,
                                      }}
                                    >
                                      ✓ Paid
                                    </span>
                                    {share.paidAt && (
                                      <span
                                        style={{
                                          display: 'block',
                                          fontSize: '0.72rem',
                                          color: '#64748b',
                                          marginTop: 2,
                                        }}
                                      >
                                        {formatDate(share.paidAt)}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'flex-end',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      disabled={state.loading}
                                      onClick={() => handlePayShare(bill.id, share.id)}
                                      style={{
                                        padding: '6px 14px',
                                        borderRadius: 6,
                                        border: '1px solid #2563eb',
                                        background: '#2563eb',
                                        color: '#ffffff',
                                        fontWeight: 600,
                                        fontSize: '0.85rem',
                                        cursor: state.loading ? 'wait' : 'pointer',
                                        opacity: state.loading ? 0.7 : 1,
                                      }}
                                    >
                                      {state.loading ? 'Paying...' : 'Pay Share'}
                                    </button>

                                    {/* Inline Error on Payment Failure */}
                                    {state.error && (
                                      <span
                                        role="alert"
                                        style={{
                                          color: '#dc2626',
                                          fontSize: '0.78rem',
                                          marginTop: 4,
                                          fontWeight: 500,
                                        }}
                                      >
                                        Payment failed: {state.error}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
