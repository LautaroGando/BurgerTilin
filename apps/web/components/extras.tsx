'use client';
import { useState, useEffect, useRef } from 'react';
import { api, money, channelLabel } from '../lib/api';
import { Modal, Field, ErrorBox, Toggle } from './ui';
export function ImportButton() {
  const [open, setOpen] = useState(false),
    [file, setFile] = useState<any>(),
    [result, setResult] = useState<any>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(confirm: boolean) {
    setBusy(true);
    try {
      setResult(await api('admin/import', { ...file, confirm }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="secondary" onClick={() => setOpen(true)}>
        Importar archivo
      </button>
      {open && (
        <Modal title="Importar ventas de otro canal" close={() => setOpen(false)}>
          <p className="muted">
            Subí un archivo JSON Burger Tilín v1 con ventas de WhatsApp o Apps. Los IDs externos
            evitan duplicados.
          </p>
          <Field label="Archivo JSON">
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                try {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 500000) throw new Error('Máximo 500 KB');
                  setFile(JSON.parse(await f.text()));
                  setResult(undefined);
                  setError('');
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            />
          </Field>
          <button className="secondary" disabled={!file || busy} onClick={() => run(false)}>
            Validar y ver vista previa
          </button>
          {result && (
            <>
              <div className="receipt">
                {result.results.map((r: any, i: number) => (
                  <div key={i}>
                    <b>{r.externalId}</b>
                    <span>
                      {r.ok
                        ? r.duplicate
                          ? 'Ya importado'
                          : r.number
                            ? `Pedido #${r.number}`
                            : money(r.subtotal)
                        : r.error}
                    </span>
                  </div>
                ))}
              </div>
              {!result.confirmed && (
                <button
                  className="primary full"
                  disabled={busy || result.results.some((r: any) => !r.ok)}
                  onClick={() => run(true)}
                >
                  Confirmar importación
                </button>
              )}
              {result.confirmed && (
                <p className="notice">
                  Importación procesada. Los registros con error no se guardaron y pueden
                  reintentarse con el mismo ID externo.
                </p>
              )}
            </>
          )}
          <ErrorBox message={error} />
        </Modal>
      )}
    </>
  );
}
export function RepeatButton({ id }: { id: string }) {
  const dismiss = useRef<() => void>(null);
  const [draft, setDraft] = useState<any>(),
    [methods, setMethods] = useState<any[]>([]),
    [method, setMethod] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="text-action"
        onClick={async () => {
          try {
            const [d, s] = await Promise.all([
              api(`admin/orders/${id}/repeat`),
              api('admin/settings'),
            ]);
            setDraft({ ...d, key: crypto.randomUUID() });
            const availableMethods = s.methods.filter(
              (m: any) =>
                m.enabled && (d.fulfillment !== 'PLATFORM' || ['cash', 'transfer'].includes(m.id)),
            );
            setMethods(availableMethods);
            setMethod(availableMethods[0]?.id || '');
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        Repetir con precios actuales
      </button>
      {error && <ErrorBox message={error} />}
      {draft && (
        <Modal title="Revisar pedido repetido" close={() => setDraft(null)} dismissRef={dismiss}>
          <p className="muted">
            Se validan otra vez precio y disponibilidad al confirmar.
            {draft.fulfillment !== 'PLATFORM' && ' Revisá dirección y entrega con el cliente.'}
          </p>
          <p className="muted">Canal de la nueva venta: {channelLabel(draft.channel)}</p>
          {draft.quote.items.map((i: any, j: number) => (
            <div className="receipt-total" key={j}>
              <span>
                {i.quantity} × {i.name}
              </span>
              <b>{money(i.unitPrice * i.quantity)}</b>
            </div>
          ))}
          {draft.fulfillment !== 'PLATFORM' && (
            <Field label="Dirección de entrega">
              <input
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </Field>
          )}
          <Field label="Medio de pago">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <ErrorBox message={error} />
          <button
            className="primary full"
            disabled={busy || !method}
            onClick={async () => {
              setBusy(true);
              try {
                const endpoint =
                  draft.fulfillment === 'PLATFORM' ? 'admin/orders/quick-apps-sale' : 'admin/orders';
                await api(endpoint, { ...draft, method });
                dismiss.current?.();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirmar nuevo pedido
          </button>
        </Modal>
      )}
    </>
  );
}
export function Settlements() {
  const [payments, setPayments] = useState<any[]>([]),
    [methods, setMethods] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [method, setMethod] = useState(''),
    [reference, setReference] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = () =>
    api('admin/receivables')
      .then(setPayments)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api('admin/settings').then((s) => {
      const m = s.methods.filter((m: any) => m.enabled && !m.receivable);
      setMethods(m);
      setMethod(m[0]?.id || '');
    });
  }, []);
  const amount = payments.filter((p) => selected.includes(p.id)).reduce((a, p) => a + p.net, 0);
  return (
    <section className="panel">
      <h2>Liquidaciones de plataformas pendientes</h2>
      <p className="muted small">
        Marcá los pagos incluidos en una liquidación de un mismo canal. El ingreso cancela la cuenta
        pendiente y no genera otra venta.
      </p>
      {payments.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Pedido</th>
                  <th>Canal</th>
                  <th>Bruto</th>
                  <th>Neto esperado</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Toggle
                        aria-label={`Liquidar pedido ${p.order.number}`}
                        checked={selected.includes(p.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, p.id]
                              : selected.filter((id) => id !== p.id),
                          )
                        }
                      />
                    </td>
                    <td>#{p.order.number}</td>
                    <td>{channelLabel(p.order.channel)}</td>
                    <td>{money(p.amount)}</td>
                    <td>{money(p.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected.length > 0 && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api('admin/settlements', {
                    key: crypto.randomUUID(),
                    paymentIds: selected,
                    amount,
                    method,
                    reference,
                  });
                  setSelected([]);
                  setReference('');
                  load();
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-grid">
                <Field label="Medio en el que ingresó">
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    {methods.map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Referencia de liquidación">
                  <input
                    required
                    minLength={3}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              </div>
              <button className="primary" disabled={busy}>
                Verifiqué el ingreso de {money(amount)}
              </button>
            </form>
          )}
        </>
      ) : (
        <p className="muted">No hay liquidaciones pendientes.</p>
      )}
      <ErrorBox message={error} />
    </section>
  );
}
