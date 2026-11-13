'use client';
import { useState, useEffect, useRef } from 'react';
import { Download, Printer, Plus, ArrowUpRight, Wallet, Check, Search, X } from 'lucide-react';
import { api, money, date, statusNames, channelLabel } from '../lib/api';
import { Modal, Empty, Field, ErrorBox, Toggle } from './ui';
import { ImportButton, RepeatButton, Settlements } from './extras';
import ArchiveDialog from './archive-dialog';
function mods(i: any) {
  return [
    i.variant,
    ...(i.extras || []).map((x: string) => '+ ' + x),
    ...(i.remove || []).map((x: string) => 'SIN ' + x),
  ]
    .filter(Boolean)
    .join(' · ');
}
export function OrderDetail({
  order: o,
  kitchen = false,
  close,
  changed,
}: {
  order: any;
  kitchen?: boolean;
  close: () => void;
  changed: () => void;
}) {
  const [error, setError] = useState(''),
    [methods, setMethods] = useState<any[]>([]),
    [payments, setPayments] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [rider, setRider] = useState(o.rider || '');
  useEffect(() => {
    if (kitchen) return;
    api('admin/settings').then((s) => {
      setMethods(s.methods.filter((m: any) => m.enabled));
      setPayments([
        {
          method: s.methods.find((m: any) => m.enabled)?.id || '',
          amount: o.total,
          verified: false,
        },
      ]);
    });
  }, [kitchen, o.total]);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    try {
      await fn();
      changed();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title={`Pedido #${o.number}`} close={close}>
      <div className="printable">
        <div className="print-heading">BURGER TILÍN · COMANDA #{o.number}</div>
        <div className="row spread">
          <b>{o.fulfillment === 'DELIVERY' ? 'Delivery' : 'Retiro'}</b>
          <span>{date(o.createdAt)}</span>
          <span className="tag">{statusNames[o.status]}</span>
        </div>
        {o.items.map((i: any, k: number) => (
          <div className="detail-item" key={k}>
            <b>
              {i.quantity} × {i.name}
            </b>
            <p>{mods(i)}</p>
            {i.components?.map((c: any, j: number) => (
              <p key={j}>
                ↳ {c.name} {mods(c)}
              </p>
            ))}
            {i.note && <strong>Nota: {i.note}</strong>}
          </div>
        ))}
        {o.notes && (
          <div className="notice">
            <b>Nota del pedido:</b> {o.notes}
          </div>
        )}
        <p>Demora estimada: {o.estimatedMinutes} min</p>
        {!kitchen && (
          <>
            <div className="customer-detail">
              <b>{o.customerName}</b>
              <span>{o.phone}</span>
              <span>{o.address}</span>
              {o.address && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`}
                >
                  Consultar dirección en mapa <ArrowUpRight size={14} />
                </a>
              )}
            </div>
            <div className="receipt">
              <div>
                <span>Productos</span>
                <b>{money(o.subtotal)}</b>
              </div>
              <div>
                <span>Envío</span>
                <b>{money(o.shipping)}</b>
              </div>
              <div>
                <span>Descuento</span>
                <b>{money(o.discount)}</b>
              </div>
              <div className="receipt-total">
                <span>Total</span>
                <b>{money(o.total)}</b>
              </div>
              <div>
                <span>Comisión del canal</span>
                <b>{money(o.commission)}</b>
              </div>
              <div>
                <span>Costo de insumos</span>
                <b>{o.ingredientCost === null ? 'Incompleto' : money(o.ingredientCost)}</b>
              </div>
              <div>
                <span>Pago</span>
                <b>{statusNames[o.paymentStatus]}</b>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="no-print">
        <button className="secondary" onClick={() => window.print()}>
          <Printer size={17} />
          Imprimir comanda
        </button>
        {!kitchen && (
          <>
            <section className="editor-block">
              <h3>Cobros y pagos</h3>
              {o.payments
                ?.filter((p: any) => p.status !== 'REPLACED')
                .map((p: any) => (
                  <div className="payment-record" key={p.id}>
                    <span>
                      {p.method === 'mercadopago_online'
                        ? 'Mercado Pago'
                        : methods.find((m) => m.id === p.method)?.name || p.method}{' '}
                      · {money(p.amount)}
                      <small>
                        {statusNames[p.status]} · Comisión {money(p.fee)}
                      </small>
                    </span>
                    {p.status === 'PENDING' && p.method !== 'mercadopago_online' && (
                      <button
                        className="secondary small"
                        disabled={busy}
                        onClick={() => run(() => api(`admin/payments/${p.id}/verify`, {}))}
                      >
                        <Check size={14} />
                        Verifiqué el ingreso
                      </button>
                    )}
                    {p.status === 'CONFIRMED' &&
                      p.amount > 0 &&
                      p.method === 'mercadopago_online' && (
                        <small>Reembolsos desde tu cuenta de Mercado Pago.</small>
                      )}
                    {p.status === 'CONFIRMED' &&
                      p.amount > 0 &&
                      p.method !== 'mercadopago_online' && (
                        <button
                          className="danger-text"
                          disabled={busy || reason.length < 3}
                          onClick={() =>
                            run(() =>
                              api(`admin/orders/${o.id}/refund`, {
                                key: crypto.randomUUID(),
                                paymentId: p.id,
                                reason,
                              }),
                            )
                          }
                        >
                          Reembolsar
                        </button>
                      )}
                  </div>
                ))}
              {o.payments?.some(
                (p: any) =>
                  p.status === 'CONFIRMED' && p.amount > 0 && p.method !== 'mercadopago_online',
              ) && (
                <Field label="Motivo de reembolso">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} />
                </Field>
              )}
              {!o.payments?.some(
                (p: any) => p.status === 'CONFIRMED' || p.method === 'mercadopago_online',
              ) &&
                !['CANCELLED', 'REJECTED'].includes(o.status) && (
                  <>
                    <h4>Registrar cobro / dividir pago</h4>
                    {payments.map((p, i) => (
                      <div className="payment-edit" key={i}>
                        <select
                          aria-label="Medio"
                          value={p.method}
                          onChange={(e) =>
                            setPayments(
                              payments.map((x, j) =>
                                j === i ? { ...x, method: e.target.value, verified: false } : x,
                              ),
                            )
                          }
                        >
                          {methods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="Importe ARS"
                          type="number"
                          min="0"
                          step="0.01"
                          value={p.amount / 100}
                          onChange={(e) =>
                            setPayments(
                              payments.map((x, j) =>
                                j === i
                                  ? { ...x, amount: Math.round(Number(e.target.value) * 100) }
                                  : x,
                              ),
                            )
                          }
                        />
                        <label className="check-row">
                          <Toggle
                            checked={p.verified}
                            onChange={(e) =>
                              setPayments(
                                payments.map((x, j) =>
                                  j === i ? { ...x, verified: e.target.checked } : x,
                                ),
                              )
                            }
                          />
                          Ingreso verificado
                        </label>
                        <button
                          className="icon-btn"
                          aria-label="Quitar medio de este cobro"
                          onClick={() => setPayments(payments.filter((_, j) => j !== i))}
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ))}
                    <div className="row spread">
                      <button
                        className="secondary"
                        onClick={() =>
                          setPayments([
                            ...payments,
                            {
                              method: methods[0]?.id || '',
                              amount: Math.max(
                                0,
                                o.total - payments.reduce((a, p) => a + p.amount, 0),
                              ),
                              verified: false,
                            },
                          ])
                        }
                      >
                        <Plus size={15} />
                        Otro medio
                      </button>
                      <button
                        className="primary"
                        disabled={busy || !payments.length}
                        onClick={() =>
                          run(() =>
                            api(`admin/orders/${o.id}/payments`, {
                              key: crypto.randomUUID(),
                              payments,
                            }),
                          )
                        }
                      >
                        Guardar cobro
                      </button>
                    </div>
                  </>
                )}
            </section>
            {o.fulfillment === 'DELIVERY' && (
              <div className="row">
                <Field label="Repartidor (opcional)">
                  <input value={rider} onChange={(e) => setRider(e.target.value)} />
                </Field>
                <button
                  className="secondary"
                  onClick={() => run(() => api(`admin/orders/${o.id}/rider`, { rider }, 'PATCH'))}
                >
                  Asignar
                </button>
              </div>
            )}
            {!['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status) && (
              <div className="editor-block">
                <p className="muted">
                  {o.consumed
                    ? 'Ya se consumieron los ingredientes. La cancelación registra merma; cualquier devolución se hace explícitamente en Inventario.'
                    : 'Cancelar libera las reservas de ingredientes.'}{' '}
                  Los cobros se reembolsan por separado.
                </p>
                <div className="row">
                  {o.status === 'NEW' && (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          api(`admin/orders/${o.id}/status`, { status: 'REJECTED' }, 'PATCH'),
                        )
                      }
                    >
                      Rechazar pedido
                    </button>
                  )}
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        api(`admin/orders/${o.id}/status`, { status: 'CANCELLED' }, 'PATCH'),
                      )
                    }
                  >
                    Cancelar pedido
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
    new Date(),
  );
}
export function SalesView({ role }: { role: string }) {
  const [filters, setFilters] = useState({
      from: today(),
      to: today(),
      channel: '',
      status: '',
      method: '',
      shift: '',
    }),
    [settings, setSettings] = useState<any>(),
    [data, setData] = useState<any>(),
    [loadedQuery, setLoadedQuery] = useState<string>(),
    [error, setError] = useState(''),
    [archived, setArchived] = useState(false),
    [archiveTarget, setArchiveTarget] = useState<{ id: string; number: number }>(),
    [detail, setDetail] = useState<any>();
  const query = new URLSearchParams(
    Object.entries({ ...filters, archived: archived ? 'true' : '' }).filter(([, v]) => v),
  ).toString();
  const salesRequest = useRef(0);
  const load = () => {
    const request = ++salesRequest.current;
    return api('admin/sales?' + query)
      .then((result) => {
        if (request !== salesRequest.current) return;
        setData(result);
        setLoadedQuery(query);
      })
      .catch((e) => {
        if (request === salesRequest.current) setError(e.message);
      });
  };
  useEffect(() => {
    api('admin/settings').then(setSettings);
  }, []);
  useEffect(() => {
    load();
  }, [query]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">CADA VENTA, EN SU LUGAR</span>
          <h1>Registro de ventas.</h1>
          <p className="muted">Consultá, filtrá y exportá. Sin planillas paralelas.</p>
        </div>
        <div className="row">
          <ImportButton />
          <a className="secondary" href={'/api/admin/sales.csv?' + query}>
            <Download size={17} />
            Exportar CSV
          </a>
        </div>
      </div>
      {role === 'OWNER' && (
        <div className="category-tabs">
          <button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>
            Registro
          </button>
          <button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>
            Archivados
          </button>
        </div>
      )}
      <div className="filter-bar">
        {[
          ['from', 'Desde'],
          ['to', 'Hasta'],
        ].map(([k, l]) => (
          <Field key={k} label={l}>
            <input
              type="date"
              value={(filters as any)[k]}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="Canal">
          <select
            value={filters.channel}
            onChange={(e) => setFilters({ ...filters, channel: e.target.value })}
          >
            <option value="">Todos</option>
            {settings?.channels.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estado">
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Todos</option>
            {[
              'NEW',
              'ACCEPTED',
              'PREPARING',
              'READY',
              'DISPATCHED',
              'DELIVERED',
              'CANCELLED',
              'REJECTED',
            ].map((s) => (
              <option value={s} key={s}>
                {statusNames[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Medio de pago">
          <select
            value={filters.method}
            onChange={(e) => setFilters({ ...filters, method: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="mercadopago_online">Mercado Pago</option>
            {settings?.methods
              .filter((m: any) => m.id !== 'mercadopago_online')
              .map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="ID de turno (opcional)">
          <input
            value={filters.shift}
            onChange={(e) => setFilters({ ...filters, shift: e.target.value })}
          />
        </Field>
      </div>
      <ErrorBox message={error} />
      {data && loadedQuery === query && (
        <>
          <div className="metric-grid">
            <Metric label="Ventas brutas" value={money(data.totals.gross)} />
            <Metric label="Cobrado" value={money(data.totals.collected)} />
            <Metric label="Pagos pendientes" value={money(data.totals.pending)} />
            <Metric label="Pedidos válidos" value={data.totals.orders} />
          </div>
          <p className="muted small">Los totales del período incluyen las ventas archivadas.</p>
          {data.truncated && (
            <div className="notice">
              Se muestran hasta 5.000 ventas. Reducí el período para ver y exportar todas.
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fecha y hora</th>
                  <th>Cliente</th>
                  <th>Canal</th>
                  <th>Total</th>
                  <th>Pago</th>
                  <th>Pedido</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o: any) => (
                  <tr key={o.id}>
                    <td>
                      <b>#{o.number}</b>
                    </td>
                    <td>{date(o.createdAt)}</td>
                    <td>{o.customerName}</td>
                    <td>{channelLabel(o.channel)}</td>
                    <td>
                      <b>{money(o.total)}</b>
                    </td>
                    <td>
                      <span className={'tag ' + (o.paymentStatus === 'PAID' ? 'green' : '')}>
                        {statusNames[o.paymentStatus]}
                      </span>
                    </td>
                    <td>{statusNames[o.status]}</td>
                    <td>
                      <div className="row">
                        <button className="text-action" onClick={() => setDetail(o)}>
                          Detalle <ArrowUpRight size={15} />
                        </button>
                        {role === 'OWNER' &&
                          (archived ||
                            ['DELIVERED', 'REJECTED', 'CANCELLED'].includes(o.status)) && (
                            <button
                              className={archived ? 'text-action' : 'danger-text'}
                              onClick={() => setArchiveTarget(o)}
                            >
                              {archived ? 'Restaurar' : 'Archivar'}
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.orders.length && (
              <Empty
                title={
                  archived
                    ? 'No hay ventas archivadas en este período'
                    : 'No hay ventas en este período'
                }
              />
            )}
          </div>
        </>
      )}
      {archiveTarget && (
        <ArchiveDialog
          name={`pedido #${archiveTarget.number}`}
          description={
            archived
              ? 'El pedido volverá al registro de ventas.'
              : 'El pedido pasará a Archivados y seguirá contando en los totales del período.'
          }
          path={`admin/sales/${archiveTarget.id}`}
          restore={archived}
          close={() => setArchiveTarget(undefined)}
          changed={load}
        />
      )}
      {detail && (
        <OrderDetail
          order={detail}
          close={() => setDetail(null)}
          changed={() => {
            setDetail(null);
            load();
          }}
        />
      )}
    </>
  );
}
export function Metric({ label, value, note }: { label: string; value: any; note?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function CashView() {
  const [shift, setShift] = useState<any>(undefined),
    [settings, setSettings] = useState<any>(),
    [amount, setAmount] = useState(''),
    [error, setError] = useState(''),
    [result, setResult] = useState<any>(),
    [mode, setMode] = useState(''),
    [entry, setEntry] = useState({ amount: 0, method: 'cash', category: 'EXPENSE', note: '' }),
    [busy, setBusy] = useState(false);
  const load = () =>
    api('admin/shift')
      .then(setShift)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api('admin/settings')
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      if (mode === 'close') {
        setResult(r);
        setShift(null);
      }
      if (mode === '') setResult(undefined);
      setMode('');
      setAmount('');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">NÚMEROS CLAROS</span>
          <h1>Caja del turno.</h1>
          <p className="muted">Lo que entra, lo que sale y lo que hay en el cajón.</p>
        </div>
        {shift && (
          <div className="row">
            <button className="secondary" disabled={busy} onClick={() => setMode('entry')}>
              <Plus size={17} />
              Movimiento
            </button>
            <button className="primary" disabled={busy} onClick={() => setMode('close')}>
              Cerrar caja <ArrowUpRight size={17} />
            </button>
          </div>
        )}
      </div>
      <ErrorBox message={error} />
      {shift ? (
        <>
          <div className="notice">
            Caja abierta el {date(shift.openedAt)} · ID {shift.id}
          </div>
          <div className="metric-grid">
            <Metric label="Fondo inicial" value={money(shift.opening)} />
            <Metric
              label="Efectivo esperado"
              value={money(shift.expected)}
              note="Saldo del cajón; no es ganancia"
            />
            <Metric
              label="Cobros verificados"
              value={money(shift.payments.reduce((a: number, p: any) => a + p.amount, 0))}
            />
            <Metric label="Movimientos manuales" value={shift.entries.length} />
          </div>
          <div className="panel">
            <h2>Movimientos del turno</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Concepto</th>
                    <th>Medio</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {shift.entries.map((e: any) => (
                    <tr key={e.id}>
                      <td>{date(e.createdAt)}</td>
                      <td>
                        {e.category}
                        <small>{e.note}</small>
                      </td>
                      <td>{e.method}</td>
                      <td>{money(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!shift.entries.length && (
              <p className="muted">Todavía no registraste movimientos manuales.</p>
            )}
          </div>
          <p className="muted small">
            Las compras de insumos registran stock. Registrá el pago al proveedor como egreso para
            reflejarlo en caja.
          </p>
        </>
      ) : shift === null ? (
        <div className="panel">
          <Empty title="Empezá un nuevo turno" icon={<Wallet size={36} />}>
            Ingresá el fondo de efectivo para abrir la caja.
          </Empty>
          <form
            className="open-cash"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api('admin/shift/open', { opening: Math.round(Number(amount) * 100) }));
            }}
          >
            <Field label="Fondo inicial (ARS)">
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <button className="primary" disabled={busy}>
              Abrir caja
            </button>
          </form>
        </div>
      ) : error ? (
        <button
          className="secondary"
          onClick={() => {
            setError('');
            load();
          }}
        >
          Volver a consultar la caja
        </button>
      ) : (
        <p className="muted">Consultando el estado de la caja…</p>
      )}
      {shift && <Settlements />}
      {result && (
        <div className="success-message">
          Caja cerrada. Esperado: {money(result.expected)} · Contado: {money(result.counted)} ·
          Diferencia: {money(result.difference)}
        </div>
      )}
      {mode && (
        <Modal
          title={mode === 'close' ? 'Cerrar caja' : 'Movimiento de caja'}
          close={() => {
            if (!busy) setMode('');
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() =>
                mode === 'close'
                  ? api('admin/shift/close', {
                      shiftId: shift.id,
                      counted: Math.round(Number(amount) * 100),
                    })
                  : api('admin/shift/entries', {
                      ...entry,
                      amount: ['EXPENSE', 'WITHDRAWAL'].includes(entry.category)
                        ? -Math.abs(entry.amount)
                        : Math.abs(entry.amount),
                      key: crypto.randomUUID(),
                    }),
              );
            }}
          >
            {mode === 'close' ? (
              <>
                <p>
                  Contá el efectivo que hay físicamente en el cajón. El cierre conserva cualquier
                  diferencia.
                </p>
                <Field label="Efectivo contado (ARS)">
                  <input
                    required
                    autoFocus
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Concepto">
                  <select
                    value={entry.category}
                    onChange={(e) => setEntry({ ...entry, category: e.target.value })}
                  >
                    <option value="EXPENSE">Gasto operativo / proveedor</option>
                    <option value="WITHDRAWAL">Retiro de dinero</option>
                    <option value="INCOME">Ingreso manual</option>
                  </select>
                </Field>
                <Field label="Importe (ARS)">
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={entry.amount / 100}
                    onChange={(e) =>
                      setEntry({ ...entry, amount: Math.round(Number(e.target.value) * 100) })
                    }
                  />
                </Field>
                <Field label="Medio">
                  <select
                    value={entry.method}
                    onChange={(e) => setEntry({ ...entry, method: e.target.value })}
                  >
                    {settings?.methods
                      .filter((m: any) => m.enabled)
                      .map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Detalle / referencia">
                  <input
                    required
                    minLength={3}
                    value={entry.note}
                    onChange={(e) => setEntry({ ...entry, note: e.target.value })}
                  />
                </Field>
              </>
            )}
            <ErrorBox message={error} />
            <button className="primary full" disabled={busy}>
              {mode === 'close' ? 'Confirmar cierre' : 'Guardar movimiento'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function CustomersView() {
  const [customers, setCustomers] = useState<any[]>([]),
    [history, setHistory] = useState<any>(),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  useEffect(() => {
    api('admin/customers')
      .then(setCustomers)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">LOS QUE VUELVEN</span>
          <h1>Clientes.</h1>
          <p className="muted">El historial se guarda automáticamente por teléfono normalizado.</p>
        </div>
      </div>
      <label className="search">
        <Search size={17} />
        <input
          placeholder="Nombre o teléfono"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ErrorBox message={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Pedidos</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers
              .filter((c) => (c.name + c.phone).toLowerCase().includes(query.toLowerCase()))
              .map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td>{c.phone}</td>
                  <td>{c._count.orders}</td>
                  <td>
                    <button
                      className="text-action"
                      onClick={async () => {
                        try {
                          setHistory(await api('admin/customers/' + c.id));
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      Ver historial <ArrowUpRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {history && (
        <Modal title={history.name} close={() => setHistory(null)}>
          {history.orders.map((o: any) => (
            <div className="receipt" key={o.id}>
              <div>
                <b>
                  #{o.number} · {date(o.createdAt)}
                </b>
                <b>{money(o.total)}</b>
              </div>
              {o.items.map((i: any, j: number) => (
                <p key={j}>
                  {i.quantity} × {i.name}
                </p>
              ))}
              <RepeatButton id={o.id} />
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}
const reportPeriods = [
  ['day', 'Día'],
  ['week', 'Semana'],
  ['month', 'Mes'],
  ['year', 'Año'],
  ['history', 'Histórico'],
] as const;

const reportMetrics = [
  ['sales', 'Ventas'],
  ['collected', 'Cobros'],
  ['orders', 'Pedidos'],
] as const;

type ReportMetric = (typeof reportMetrics)[number][0];
type ReportPoint = {
  time: number;
  label: string;
  sales: number;
  collected: number;
  orders: number;
};
type Report = {
  from: string | null;
  to: string;
  points: ReportPoint[];
  popular: [string, number][];
  totals: Record<
    | 'orders'
    | 'gross'
    | 'discount'
    | 'refunds'
    | 'fees'
    | 'net'
    | 'collected'
    | 'cost'
    | 'margin'
    | 'expenses'
    | 'afterExpenses'
    | 'cashDifferences'
    | 'pendingSettlement'
    | 'average',
    number
  > & { incompleteCosts: boolean };
};

function ReportChart({ points }: { points: ReportPoint[] }) {
  const [metric, setMetric] = useState<ReportMetric>('sales');
  const [selectedTime, setSelectedTime] = useState<number>();
  const label = reportMetrics.find(([key]) => key === metric)?.[1];
  const display = (value: number) =>
    metric === 'orders' ? value.toLocaleString('es-AR') : money(value);
  const values = points.map((point) => point[metric]);
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const scale = high - low || 1;
  const zero = (100 * high) / scale;
  const selected = points.find((point) => point.time === selectedTime);

  return (
    <section className="panel report-panel" aria-label="Gráfico de rendimiento">
      <div className="report-chart-heading">
        <div>
          <h2>Evolución</h2>
          <p className="muted small">Ventas con descuentos y cobros registrados en su fecha.</p>
        </div>
        <div className="report-options" role="group" aria-label="Métrica del gráfico">
          {reportMetrics.map(([key, name]) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      {high || low ? (
        <>
          <div className="report-plot" role="group" aria-label={label}>
            {points.map((point) => {
              const value = point[metric];
              const height = (100 * Math.abs(value)) / scale;
              const top = value >= 0 ? zero - height : zero;
              return (
                <button
                  key={point.time}
                  type="button"
                  className="report-bar"
                  aria-pressed={selectedTime === point.time}
                  aria-label={point.label + ' · ' + display(value)}
                  title={point.label + ' · ' + display(value)}
                  onClick={() => setSelectedTime(point.time)}
                >
                  <span className="report-bar-track" aria-hidden="true">
                    <span className="report-zero" style={{ top: zero + '%' }} />
                    {value !== 0 && (
                      <span
                        className="report-bar-fill"
                        style={{ top: top + '%', height: height + '%' }}
                      />
                    )}
                  </span>
                  <span>{point.label}</span>
                </button>
              );
            })}
          </div>
          <p className="report-point" aria-live="polite">
            {selected
              ? selected.label + ' · ' + label + ' · ' + display(selected[metric])
              : 'Elegí una barra para ver su valor.'}
          </p>
        </>
      ) : (
        <Empty title={'Sin ' + label?.toLowerCase() + ' en este período'} />
      )}
      {points.some((point) => point.sales || point.collected || point.orders) && (
        <details className="report-table">
          <summary>Ver datos del gráfico</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Ventas</th>
                  <th>Cobros</th>
                  <th>Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.time}>
                    <td>{point.label}</td>
                    <td>{money(point.sales)}</td>
                    <td>{money(point.collected)}</td>
                    <td>{point.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

export function ReportsView() {
  const [period, setPeriod] = useState<(typeof reportPeriods)[number][0]>('day');
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Report>();
  const [inventory, setInventory] = useState<any>();
  const [error, setError] = useState('');
  const [stockError, setStockError] = useState('');

  useEffect(() => {
    let active = true;
    setData(undefined);
    setError('');
    const params = new URLSearchParams({ period });
    if (period !== 'history') params.set('date', date);
    api('admin/performance?' + params)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [period, date]);

  useEffect(() => {
    let active = true;
    api('admin/inventory')
      .then((value) => {
        if (active) setInventory(value);
      })
      .catch((e) => {
        if (active) setStockError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const formatDate = (value: string) => value.split('-').reverse().join('/');

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Rendimiento</h1>
          <p className="muted">Consultá ventas, cobros y margen estimado por período.</p>
        </div>
      </div>
      <div className="report-toolbar">
        <div className="report-options" role="group" aria-label="Período del informe">
          {reportPeriods.map(([key, name]) => (
            <button
              key={key}
              type="button"
              aria-pressed={period === key}
              onClick={() => setPeriod(key)}
            >
              {name}
            </button>
          ))}
        </div>
        {period !== 'history' && (
          <label className="report-date">
            Fecha de referencia
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </label>
        )}
      </div>
      <ErrorBox message={error} />
      {!data && !error && (
        <p role="status" className="muted">
          Cargando el informe…
        </p>
      )}
      {data && (
        <>
          {data.from && (
            <p className="muted small">
              {formatDate(data.from)}
              {data.to !== data.from && ' al ' + formatDate(data.to)} · Hora de Buenos Aires
            </p>
          )}
          <div className="metric-grid">
            <Metric label="Ventas brutas" value={money(data.totals.gross)} />
            <Metric label="Pedidos" value={data.totals.orders} />
            <Metric label="Ticket promedio" value={money(data.totals.average)} />
            <Metric label="Dinero cobrado" value={money(data.totals.collected)} />
          </div>
          <ReportChart key={period + date} points={data.points} />
          <div className="two-columns">
            <section className="panel">
              <h2>Detalle del período</h2>
              <div className="receipt">
                {[
                  ['Ventas brutas', data.totals.gross],
                  ['Descuentos', data.totals.discount],
                  ['Reembolsos', data.totals.refunds],
                  ['Comisiones', data.totals.fees],
                  ['Neto a recibir', data.totals.net],
                  ['Costo de insumos y packaging', data.totals.cost],
                  ['Margen estimado antes de gastos', data.totals.margin],
                  ['Gastos operativos', data.totals.expenses],
                  ['Resultado estimado', data.totals.afterExpenses],
                  ['Diferencias de caja', data.totals.cashDifferences],
                  ['Plataformas pendientes', data.totals.pendingSettlement],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <b>{money(Number(value))}</b>
                  </div>
                ))}
              </div>
              {data.totals.incompleteCosts && (
                <div className="notice">
                  Margen incompleto: hay ventas sin receta o sin costos cargados.
                </div>
              )}
            </section>
            <section className="panel">
              <h2>Lo más pedido</h2>
              {data.popular.map(([name, quantity], i) => (
                <div className="popular-row" key={name}>
                  <span>{i + 1}</span>
                  <b>{name}</b>
                  <strong>{quantity}</strong>
                </div>
              ))}
              {!data.popular.length && <Empty title="Todavía no hay ventas en este período" />}
            </section>
          </div>
        </>
      )}
      <ErrorBox message={stockError} />
      {inventory?.replenishment.length > 0 && (
        <section className="panel">
          <h2>Atención al stock</h2>
          {inventory.replenishment.map((i: any) => (
            <div className="receipt-total" key={i.id}>
              <span>{i.name}</span>
              <b>
                Reponer {i.suggested} {i.unit}
              </b>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
